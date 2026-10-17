-- Near-cable recording in every watched region through one code path. The recorder (supabase/functions/
-- record-vessel-positions) sends Digitraffic reports for the regions recorded from Digitraffic and a minute's
-- aisstream reports for the others; the database finds each report's region by its box (public.watched_regions),
-- keeps it only when that region is recorded from the report's feed, matches it to that region's cables only, and
-- thins stationary repeats with that region's thresholds. Retention follows each region's hot window
-- (20261019500100_position_archive.sql), and the detector's inputs stay region-agnostic and inside the egress budget
-- (docs/REGIONS.md).
--
-- Rollback: `drop function public.ingest_vessel_positions(jsonb)`, then re-run 20261017040000_thin_stationary_positions.sql
-- (the Gulf-only two-argument version and its 14-day prune), the detection_inputs of 20261018300000_detections.sql and
-- the recorder schedule of 20261017020200_recorder_schedule.sql; then `select cron.unschedule('prune-cross-source-samples');
-- drop function public.cross_source_samples_since(integer); drop table public.cross_source_samples;
-- alter table public.recorder_runs drop column source_counts;`.

-- What each recorder run heard per feed (RecorderRun.sourceCounts in supabase/functions/record-vessel-positions/record.ts).
alter table public.recorder_runs add column source_counts jsonb;

-- The old two-argument version took one near-cable distance for every report; the distance is now the region's.
-- The recorder calls with `reports` only, so the call resolves to the new version unchanged.
drop function public.ingest_vessel_positions(jsonb, double precision);

-- Stores the reports a region records and returns how many were new. Each report: {mmsi, reportedAtMs, longitude,
-- latitude, speedKnots, courseDegrees, headingDegrees, navigationStatus, turnRate, source} (RecorderReport in
-- src/lib/regions/recording.ts). A report without `source` is a Digitraffic one, as every report was before.
create or replace function public.ingest_vessel_positions(reports jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with incoming as (
    select
      (report ->> 'mmsi')::integer as mmsi,
      to_timestamp((report ->> 'reportedAtMs')::double precision / 1000) as observed_at,
      extensions.st_setsrid(
        extensions.st_makepoint((report ->> 'longitude')::double precision, (report ->> 'latitude')::double precision),
        4326
      ) as point,
      (report ->> 'speedKnots')::real as speed_knots,
      (report ->> 'courseDegrees')::real as course_degrees,
      (report ->> 'headingDegrees')::smallint as heading_degrees,
      (report ->> 'navigationStatus')::smallint as navigation_status,
      (report ->> 'turnRate')::real as turn_rate,
      coalesce(report ->> 'source', 'digitraffic') as source
    from jsonb_array_elements(reports) as report
  ),
  located as (
    -- Boxes never overlap (findRegistryProblems); a point on a shared edge matches both, and the primary key keeps one.
    select distinct on (incoming.mmsi, incoming.observed_at)
      incoming.*,
      incoming.point::extensions.geography as position,
      region.id as region_id,
      region.near_cable_metres,
      region.stationary_knots,
      region.stationary_repeat_minutes,
      region.stationary_repeat_metres
    from incoming
    join public.watched_regions as region
      on extensions.st_intersects(region.box, incoming.point) and incoming.source = any (region.live_sources)
    order by incoming.mmsi, incoming.observed_at, region.id
  ),
  worth_storing as (
    -- A stationary report is skipped when the ship already has a stored position this recent and this close
    -- (20261017040000_thin_stationary_positions.sql, now with the region's thresholds).
    select located.*
    from located
    where not (
      coalesce(located.speed_knots, 0) < located.stationary_knots
      and exists (
        select 1
        from public.vessel_positions as previous
        where previous.mmsi = located.mmsi
          and previous.observed_at <= located.observed_at
          and previous.observed_at > located.observed_at - make_interval(mins => located.stationary_repeat_minutes)
          and extensions.st_dwithin(previous.position, located.position, located.stationary_repeat_metres)
      )
    )
  ),
  matched as (
    select worth_storing.*, nearest.id as nearest_cable_id, nearest.distance_metres
    from worth_storing
    cross join lateral (
      select cables.id, extensions.st_distance(cables.route, worth_storing.position) as distance_metres
      from public.cables
      where cables.region_id = worth_storing.region_id
        and extensions.st_dwithin(cables.route, worth_storing.position, worth_storing.near_cable_metres)
      order by distance_metres
      limit 1
    ) as nearest
  ),
  stored as (
    insert into public.vessel_positions (
      mmsi, observed_at, position, speed_knots, course_degrees, heading_degrees,
      navigation_status, turn_rate, nearest_cable_id, cable_distance_metres
    )
    select
      mmsi, observed_at, position, speed_knots, course_degrees, heading_degrees,
      navigation_status, turn_rate, nearest_cable_id, distance_metres
    from matched
    on conflict (mmsi, observed_at) do nothing
    returning 1
  )
  select count(*)::integer from stored;
$$;

revoke execute on function public.ingest_vessel_positions(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_vessel_positions(jsonb) to service_role;

-- The detector's inputs (parsed by src/lib/detection/detection-inputs.ts), now over every region. Same positions and,
-- at today's thresholds, the same ships as 20261018300000_detections.sql; two changes:
-- - cables: only those within 10 km of a candidate position, each clipped to the box around the candidate positions
--   near it, grown by 0.25 degrees. The anchor path lies within the chain's layback of the ship (hundreds of metres),
--   so every crossing and every stretch followed within 500 m stays inside what is sent. Eight regions' routes sent
--   whole would add about 160 KB to every call.
-- - vessels: ships Digitraffic does not describe (aisstream regions) take their name, type and draught from the frame
--   collector's public.live_ships (kept 47 hours), so the detector can tell a tug or a pilot boat from a cargo ship there.
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
  ),
  -- DRAG_SPEED_MIN_KNOTS and DRAG_SPEED_MAX_KNOTS in src/lib/detection/drag-rules.ts. The drag-band report must also
  -- lie within its region's candidate distance of a cable; with candidate_cable_metres equal to near_cable_metres (3 km
  -- in every region today) that holds for every stored row, so the ships sent are those of 20261018300000.
  candidate_positions as (
    select w.*
    from window_positions w
    where w.mmsi in (
      select in_band.mmsi
      from window_positions as in_band
      join public.cables as cable on cable.id = in_band.nearest_cable_id
      join public.watched_regions as region on region.id = cable.region_id
      where (in_band.speed_knots is null or in_band.speed_knots between 2 and 9)
        and in_band.cable_distance_metres <= region.candidate_cable_metres
    )
  ),
  cable_reach as (
    -- st_extent returns a box without an SRID; the routes are 4326.
    select
      cables.id,
      extensions.st_setsrid(extensions.st_expand(extensions.st_extent(candidate.position::extensions.geometry)::extensions.geometry, 0.25), 4326) as reach
    from candidate_positions as candidate
    join public.cables on extensions.st_dwithin(cables.route, candidate.position, 10000)
    group by cables.id
  ),
  candidate_ships as (
    select distinct mmsi from candidate_positions
  )
  select jsonb_build_object(
    'positions', coalesce((
      select jsonb_agg(jsonb_build_array(
        p.mmsi,
        floor(extract(epoch from p.observed_at)),
        round(extensions.st_x(p.position::extensions.geometry)::numeric, 5),
        round(extensions.st_y(p.position::extensions.geometry)::numeric, 5),
        p.speed_knots,
        p.course_degrees,
        p.heading_degrees,
        p.navigation_status
      ) order by p.mmsi, p.observed_at)
      from candidate_positions p
    ), '[]'::jsonb),
    'vessels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mmsi', ship.mmsi,
        'name', coalesce(v.name, live.name),
        'shipType', coalesce(v.ship_type, live.ship_type),
        'draughtMetres', coalesce(v.draught_metres, live.draught_metres)
      ))
      from candidate_ships as ship
      left join public.vessels v on v.mmsi = ship.mmsi
      left join public.live_ships live on live.mmsi = ship.mmsi
      where v.mmsi is not null or live.mmsi is not null
    ), '[]'::jsonb),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.name,
        'kind', c.kind,
        'route', extensions.st_asgeojson(
          extensions.st_multi(extensions.st_collectionextract(extensions.st_intersection(c.route::extensions.geometry, reach.reach), 2)),
          6
        )::jsonb
      ) order by c.id)
      from public.cables c
      join cable_reach as reach on reach.id = c.id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.detection_inputs(integer) from public, anon, authenticated;
grant execute on function public.detection_inputs(integer) to service_role;

-- Cross-source samples (src/lib/live/cross-source.ts): where two feeds cover the same water, the frame collector
-- compares them every run (every 10 minutes). The collector writes with its secret key; everyone else reads through
-- public.cross_source_samples_since below.
create table public.cross_source_samples (
  id bigint generated always as identity primary key,
  region_id text not null references public.watched_regions (id),
  sampled_at timestamptz not null,
  window_seconds integer not null,
  aisstream_ships integer not null,
  digitraffic_ships integer not null,
  shared_ships integer not null,
  aisstream_only_ships integer not null,
  matched_pairs integer not null,
  median_offset_metres real,
  p95_offset_metres real,
  within_tolerance_share real
);
create index cross_source_samples_region_time_index on public.cross_source_samples (region_id, sampled_at);
-- No table policy (20261019060000_close_public_reads.sql): public reads go through the capped function below.
alter table public.cross_source_samples enable row level security;

-- The samples of the last `since_hours` (1 to 168), oldest first, at most 1,008 rows (7 days of one region at 6 samples
-- an hour, about 150 KB), for scripts/regions/cross-source.ts and the status page with the publishable key. Row keys
-- are the table's column names, which parseCrossSourceRows in src/lib/live/cross-source.ts reads.
create or replace function public.cross_source_samples_since(since_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(recent) - 'id' order by recent.sampled_at), '[]'::jsonb)
  from (
    select *
    from public.cross_source_samples
    where sampled_at > now() - make_interval(hours => greatest(1, least(since_hours, 168)))
    order by sampled_at desc
    limit 1008
  ) as recent;
$$;

revoke execute on function public.cross_source_samples_since(integer) from public;
grant execute on function public.cross_source_samples_since(integer) to anon, authenticated;

-- Every minute, as before, now with time for the 40-second aisstream listen (LISTEN_MS in
-- supabase/functions/record-vessel-positions/index.ts): pg_net waits up to 58 s for the reply.
select cron.schedule(
  'record-vessel-positions',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'recorder_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recorder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recorder_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  );
  $$
);

select cron.schedule('prune-cross-source-samples', '53 3 * * *', $$ delete from public.cross_source_samples where sampled_at < now() - interval '14 days'; $$);
