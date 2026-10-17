-- Anchor-drag detections: what the detector (src/lib/detection, run by supabase/functions/detect-anchor-drag)
-- found in the recorded Gulf of Finland traffic. Each row is one event of one ship, ranked by evidence, never a
-- verdict: the evidence column holds the measured numbers and one plain sentence per rule that fired.

create table public.detections (
  id bigint generated always as identity primary key,
  mmsi integer not null,
  level text not null check (level in ('alert', 'watch')),
  score real not null check (score >= 0 and score <= 1),
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- [{rule, weight, measured, sentence}], see Evidence in src/lib/detection/detection-types.ts.
  evidence jsonb not null,
  cable_crossings jsonb not null default '[]'::jsonb,
  anchor_path jsonb not null default '[]'::jsonb,
  anchor_model jsonb not null,
  gaps jsonb not null default '[]'::jsonb,
  first_detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);
create index detections_mmsi_window_index on public.detections (mmsi, start_at, end_at);
create index detections_end_at_index on public.detections (end_at);

-- No table policies: everyone reads through public.recent_detections, only the detector writes.
alter table public.detections enable row level security;

-- What the detector reads on each call: recorded positions of the last `lookback_minutes`, the static data of
-- those ships, and every cable route as GeoJSON. Parsed by src/lib/detection/detection-inputs.ts; the backtest
-- (scripts/backtest/recorded-traffic.ts) builds the same payload for past spans. Keep the two in step.
create or replace function public.detection_inputs(lookback_minutes integer default 360)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with window_positions as (
    select p.*
    from public.vessel_positions p
    where p.observed_at > now() - make_interval(mins => greatest(1, least(lookback_minutes, 1440)))
  )
  select jsonb_build_object(
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mmsi', p.mmsi,
        'atMs', floor(extract(epoch from p.observed_at) * 1000),
        'longitude', extensions.st_x(p.position::extensions.geometry),
        'latitude', extensions.st_y(p.position::extensions.geometry),
        'speedKnots', p.speed_knots,
        'courseDegrees', p.course_degrees,
        'headingDegrees', p.heading_degrees,
        'navigationStatus', p.navigation_status
      ) order by p.mmsi, p.observed_at)
      from window_positions p
    ), '[]'::jsonb),
    'vessels', coalesce((
      select jsonb_agg(jsonb_build_object('mmsi', v.mmsi, 'name', v.name, 'shipType', v.ship_type, 'draughtMetres', v.draught_metres))
      from public.vessels v
      where v.mmsi in (select distinct mmsi from window_positions)
    ), '[]'::jsonb),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'route', extensions.st_asgeojson(c.route::extensions.geometry, 6)::jsonb) order by c.id)
      from public.cables c
    ), '[]'::jsonb)
  );
$$;

-- Stores detections and returns how many were written. The detector runs every 5 minutes over a sliding 6-hour
-- window, so the same event comes back on many calls: a detection of the same ship whose time window overlaps a
-- stored one updates it instead of adding a row. The window grows to cover both and an alert never drops back to
-- watch. The evidence columns (tens of kB) are rewritten when the new evidence is stronger, or equally strong and the
-- stored copy is 30 minutes old, so an ongoing event is not rewritten on every call. Each detection: {mmsi, level,
-- score, startMs, endMs, evidence, cableCrossings, anchorPath, anchorModel, gaps}.
create or replace function public.upsert_detections(detections jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming jsonb;
  incoming_start timestamptz;
  incoming_end timestamptz;
  incoming_score real;
  incoming_level text;
  existing_id bigint;
  existing_score real;
  existing_level text;
  existing_updated_at timestamptz;
  written integer := 0;
begin
  -- One writer at a time, so two overlapping calls cannot insert the same event twice.
  perform pg_advisory_xact_lock(hashtext('public.upsert_detections'));
  for incoming in select value from jsonb_array_elements(detections) loop
    incoming_start := to_timestamp((incoming ->> 'startMs')::double precision / 1000);
    incoming_end := to_timestamp((incoming ->> 'endMs')::double precision / 1000);
    incoming_score := (incoming ->> 'score')::real;
    incoming_level := incoming ->> 'level';
    existing_id := null;
    select d.id, d.score, d.level, d.updated_at into existing_id, existing_score, existing_level, existing_updated_at
    from public.detections d
    where d.mmsi = (incoming ->> 'mmsi')::integer
      and d.start_at <= incoming_end
      and incoming_start <= d.end_at
    order by d.score desc
    limit 1;
    if existing_id is null then
      insert into public.detections (mmsi, level, score, start_at, end_at, evidence, cable_crossings, anchor_path, anchor_model, gaps)
      values (
        (incoming ->> 'mmsi')::integer, incoming_level, incoming_score, incoming_start, incoming_end,
        incoming -> 'evidence', coalesce(incoming -> 'cableCrossings', '[]'::jsonb), coalesce(incoming -> 'anchorPath', '[]'::jsonb),
        incoming -> 'anchorModel', coalesce(incoming -> 'gaps', '[]'::jsonb)
      );
    elsif incoming_score > existing_score or (incoming_score = existing_score and existing_updated_at < now() - interval '30 minutes') then
      update public.detections set
        level = case when existing_level = 'alert' or incoming_level = 'alert' then 'alert' else 'watch' end,
        score = incoming_score,
        start_at = least(start_at, incoming_start),
        end_at = greatest(end_at, incoming_end),
        evidence = incoming -> 'evidence',
        cable_crossings = coalesce(incoming -> 'cableCrossings', '[]'::jsonb),
        anchor_path = coalesce(incoming -> 'anchorPath', '[]'::jsonb),
        anchor_model = incoming -> 'anchorModel',
        gaps = coalesce(incoming -> 'gaps', '[]'::jsonb),
        updated_at = now()
      where id = existing_id;
    else
      update public.detections set
        level = case when existing_level = 'alert' or incoming_level = 'alert' then 'alert' else 'watch' end,
        start_at = least(start_at, incoming_start),
        end_at = greatest(end_at, incoming_end)
      where id = existing_id;
    end if;
    written := written + 1;
  end loop;
  return written;
end;
$$;

-- Detections whose window ended in the last `since_hours` (1 to 720), alerts first, then by score, for the site with
-- the publishable key. Runs as its owner so the table itself needs no public policy.
create or replace function public.recent_detections(since_hours integer default 72)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'mmsi', d.mmsi,
    'name', v.name,
    'level', d.level,
    'score', d.score,
    'startAt', d.start_at,
    'endAt', d.end_at,
    'evidence', d.evidence,
    'cableCrossings', d.cable_crossings,
    'anchorPath', d.anchor_path,
    'anchorModel', d.anchor_model,
    'gaps', d.gaps,
    'firstDetectedAt', d.first_detected_at,
    'updatedAt', d.updated_at
  ) order by d.level = 'alert' desc, d.score desc, d.start_at desc), '[]'::jsonb)
  from public.detections d
  left join public.vessels v on v.mmsi = d.mmsi
  where d.end_at > now() - make_interval(hours => greatest(1, least(since_hours, 720)));
$$;

-- Only the detector (service role) reads its inputs and writes; everyone may read the detections.
revoke execute on function public.detection_inputs(integer) from public, anon, authenticated;
revoke execute on function public.upsert_detections(jsonb) from public, anon, authenticated;
grant execute on function public.detection_inputs(integer) to service_role;
grant execute on function public.upsert_detections(jsonb) to service_role;
grant execute on function public.recent_detections(integer) to anon, authenticated;

-- Every 5 minutes: run the detector. The function address and its shared secret live in Supabase Vault
-- (names detector_function_url and detector_secret), never in this file.
select cron.schedule(
  'detect-anchor-drag',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'detector_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-detector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'detector_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Daily: watch-level rows go with the positions they came from (kept 14 days, 20261017040000); alerts stay.
select cron.schedule(
  'prune-watch-detections',
  '37 3 * * *',
  $$ delete from public.detections where level = 'watch' and end_at < now() - interval '14 days'; $$
);
