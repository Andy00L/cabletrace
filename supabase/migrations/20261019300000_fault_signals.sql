-- Fault signals and draft cases: what the network side publishes when a cable breaks (NGA navigational warnings of
-- cable work, IODA internet outage alerts, ENTSO-E forced outages of power links), matched to the cables of
-- public.cables, and the draft cases they open: the ships recorded near the affected cable before the fault, ranked by
-- the anchor-drag detector. Written by supabase/functions/match-fault-signals (src/lib/fault-signals does the parsing,
-- matching and ranking). A draft case is a list of ships to look at first, never a finding: its status is always
-- 'draft'. Sources, terms and schedules: docs/FAULT_SIGNALS.md.

-- The countries each cable lands in, for signals that name only a country (an internet outage) or a border (a power
-- outage whose asset the operator withholds). Read from each cable's name and the ends of its route in
-- 20261017020100_seed_gulf_cables.sql; a cable seeded later needs its rows here.
create table public.cable_landing_countries (
  cable_id bigint not null references public.cables (id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  primary key (cable_id, country_code)
);

insert into public.cable_landing_countries (cable_id, country_code)
select cables.id, landing.country_code
from public.cables
join (values
  ('BCS North', 'FI'),
  ('BCS North - Phase 1', 'FI'),
  ('BCS North - Phase 2', 'FI'), ('BCS North - Phase 2', 'RU'),
  ('Baltic Sea Submarine Cable', 'EE'), ('Baltic Sea Submarine Cable', 'FI'), ('Baltic Sea Submarine Cable', 'SE'),
  ('Balticconnector', 'EE'), ('Balticconnector', 'FI'),
  ('Baltika (Kingisepp - Kaliningrad)', 'RU'),
  ('C-Lion 1', 'FI'), ('C-Lion 1', 'DE'),
  ('Eastern Light Sweden-Finland I', 'FI'), ('Eastern Light Sweden-Finland I', 'SE'),
  ('Estlink 1', 'EE'), ('Estlink 1', 'FI'),
  ('Finland Estonia Connection (FEC)', 'EE'), ('Finland Estonia Connection (FEC)', 'FI'),
  ('Finland-Estonia 2 (EESF-2)', 'EE'), ('Finland-Estonia 2 (EESF-2)', 'FI'),
  ('Finland-Estonia 3 (EESF-3)', 'EE'), ('Finland-Estonia 3 (EESF-3)', 'FI'),
  ('HVDC Estlink 2', 'EE'), ('HVDC Estlink 2', 'FI'),
  ('Nord Stream 1', 'RU'), ('Nord Stream 1', 'DE'),
  ('Nord Stream 2', 'RU'), ('Nord Stream 2', 'DE'),
  ('Tammisalo Vasikkaluoto Cable', 'FI')
) as landing (cable_name, country_code) on landing.cable_name = cables.name
on conflict do nothing;

-- One row per signal that concerns at least one registry cable. Signals that match none are not kept; their ids go
-- to public.fault_signals_seen so the next call does not match them again.
create table public.fault_signals (
  id bigint generated always as identity primary key,
  source text not null check (source in ('nga-warning', 'ioda-alert', 'entsoe-unavailability', 'nordpool-umm', 'operator-notice')),
  external_id text not null check (char_length(external_id) <= 300),
  kind text not null check (kind in ('cable-damage', 'cable-repair', 'cable-operations', 'power-link-failure', 'internet-outage')),
  title text not null check (char_length(title) <= 500),
  -- The span the source allows for the start of the fault (equal ends when it gives a time).
  fault_not_before timestamptz not null,
  fault_not_after timestamptz not null,
  published_at timestamptz not null,
  ends_at timestamptz,
  -- {kind: geometry | asset | country, ...}, see SignalLocator in src/lib/fault-signals/fault-signal-types.ts.
  locator jsonb not null,
  cable_ship text,
  source_url text not null,
  -- The source's own words, empty for IODA (no redisplay terms, docs/FAULT_SIGNALS.md). EXCERPT_MAX_CHARS is 2000.
  excerpt text not null default '' check (char_length(excerpt) <= 2000),
  first_seen_at timestamptz not null default now(),
  unique (source, external_id),
  check (fault_not_after >= fault_not_before)
);
create index fault_signals_fault_index on public.fault_signals (fault_not_before);

-- Which cables a signal concerns and why (MatchBasis in src/lib/fault-signals/cable-matcher.ts).
create table public.fault_signal_matches (
  signal_id bigint not null references public.fault_signals (id) on delete cascade,
  cable_id bigint not null references public.cables (id),
  basis text not null check (basis in ('geometry', 'asset-name', 'border', 'country')),
  distance_metres real,
  primary key (signal_id, cable_id)
);
create index fault_signal_matches_cable_index on public.fault_signal_matches (cable_id);

-- Every signal id a call has processed, matched or not.
create table public.fault_signals_seen (
  source text not null check (source in ('nga-warning', 'ioda-alert', 'entsoe-unavailability', 'nordpool-umm', 'operator-notice')),
  external_id text not null,
  seen_at timestamptz not null default now(),
  primary key (source, external_id)
);

-- One draft per cable and fault. Signals about the same cable whose fault spans lie within a day of each other join
-- one draft, which keeps the ranking built from the tightest span (isNarrowerFaultSpan in
-- src/lib/fault-signals/draft-case.ts): a trip time to the minute says more about which ship was there than "after noon".
create table public.draft_cases (
  id bigint generated always as identity primary key,
  cable_id bigint not null references public.cables (id),
  status text not null default 'draft' check (status = 'draft'),
  fault_not_before timestamptz not null,
  fault_not_after timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  near_metres real not null,
  ship_count integer not null check (ship_count >= 0),
  -- At most 20 ships (DRAFT_MAX_SHIPS): [{rank, mmsi, name, basis, level, score, crossingAtMs, closestApproachMetres,
  -- closestApproachAtMs, reportCount, sentences}], RankedShip in src/lib/fault-signals/draft-case.ts.
  ranked_ships jsonb not null check (jsonb_typeof(ranked_ships) = 'array' and jsonb_array_length(ranked_ships) <= 20),
  ranking_signal_id bigint references public.fault_signals (id) on delete set null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fault_not_after >= fault_not_before),
  check (window_end > window_start)
);
create index draft_cases_cable_fault_index on public.draft_cases (cable_id, fault_not_before);
create index draft_cases_updated_index on public.draft_cases (updated_at);

create table public.draft_case_signals (
  draft_case_id bigint not null references public.draft_cases (id) on delete cascade,
  signal_id bigint not null references public.fault_signals (id) on delete cascade,
  primary key (draft_case_id, signal_id)
);
create index draft_case_signals_signal_index on public.draft_case_signals (signal_id);

-- No table policies: everyone reads through the capped functions below, only the edge function writes.
alter table public.cable_landing_countries enable row level security;
alter table public.fault_signals enable row level security;
alter table public.fault_signal_matches enable row level security;
alter table public.fault_signals_seen enable row level security;
alter table public.draft_cases enable row level security;
alter table public.draft_case_signals enable row level security;

-- Which of these signal ids no call has processed yet (at most 1000 per call).
create or replace function public.unseen_fault_signal_ids(signal_source text, external_ids text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(candidate.external_id), '{}'::text[])
  from unnest(external_ids[1:1000]) as candidate (external_id)
  where not exists (
    select 1 from public.fault_signals_seen seen
    where seen.source = signal_source and seen.external_id = candidate.external_id
  );
$$;

-- The registry for the matcher, parsed by parseMatchInputs (src/lib/fault-signals/fault-inputs.ts): every cable with its
-- landing countries, and its route as GeoJSON only when a signal needs geometry. The routes are about 70 kB, so a call
-- for country or name matching leaves them out.
create or replace function public.fault_match_inputs(include_routes boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('cables', coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cable.id,
      'name', cable.name,
      'kind', cable.kind,
      'countries', coalesce((select jsonb_agg(landing.country_code order by landing.country_code) from public.cable_landing_countries landing where landing.cable_id = cable.id), '[]'::jsonb)
    ) || case when include_routes then jsonb_build_object('route', extensions.st_asgeojson(cable.route::extensions.geometry, 6)::jsonb) else '{}'::jsonb end
    order by cable.id
  ), '[]'::jsonb))
  from public.cables cable;
$$;

-- The recorded ships near one cable in a window, for a draft case: parsed by parseFaultCaseInputs
-- (src/lib/fault-signals/fault-inputs.ts), which mirrors splitShipsForDraft in src/lib/fault-signals/draft-case.ts.
-- Ships with a report within `near_metres` of the cable inside the window are in. Those with a report in the 2 to 9
-- knot drag band or without a reported speed (DRAG_SPEED_MIN_KNOTS and DRAG_SPEED_MAX_KNOTS in
-- src/lib/detection/drag-rules.ts, the same test as public.detection_inputs) come with their window track, the
-- detector's payload shape, against the one cable; the others come as one `passersBy` row each, their closest report:
-- [mmsi, epoch seconds, metres from the cable, speed]. The window is cut to 96 hours (DRAFT_MAX_WINDOW_MS) and the
-- distance to 5 km, so one call stays small: every call counts against the free plan's 5 GB of egress a month.
create or replace function public.fault_case_inputs(affected_cable_id bigint, window_from timestamptz, window_until timestamptz, near_metres double precision default 3000)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select greatest(window_from, window_until - interval '96 hours') as from_at, window_until as until_at, least(greatest(near_metres, 0), 5000) as near
  ),
  affected as (
    select cable.id, cable.name, cable.kind, cable.route from public.cables cable where cable.id = affected_cable_id
  ),
  window_positions as (
    select recorded.*
    from public.vessel_positions recorded, bounds bound
    where recorded.observed_at >= bound.from_at and recorded.observed_at <= bound.until_at
  ),
  near_ships as (
    select distinct windowed.mmsi
    from window_positions windowed, affected, bounds bound
    where extensions.st_dwithin(affected.route, windowed.position, bound.near)
  ),
  ship_positions as (
    select windowed.* from window_positions windowed where windowed.mmsi in (select mmsi from near_ships)
  ),
  candidate_ships as (
    select distinct tracked.mmsi from ship_positions tracked where tracked.speed_knots is null or tracked.speed_knots between 2 and 9
  ),
  passers as (
    select distinct on (tracked.mmsi) tracked.mmsi, tracked.observed_at, extensions.st_distance(affected.route, tracked.position) as distance_metres, tracked.speed_knots
    from ship_positions tracked, affected
    where tracked.mmsi not in (select mmsi from candidate_ships)
    order by tracked.mmsi, extensions.st_distance(affected.route, tracked.position), tracked.observed_at
  )
  select jsonb_build_object(
    'positions', coalesce((
      select jsonb_agg(jsonb_build_array(
        tracked.mmsi,
        floor(extract(epoch from tracked.observed_at)),
        round(extensions.st_x(tracked.position::extensions.geometry)::numeric, 5),
        round(extensions.st_y(tracked.position::extensions.geometry)::numeric, 5),
        tracked.speed_knots,
        tracked.course_degrees,
        tracked.heading_degrees,
        tracked.navigation_status
      ) order by tracked.mmsi, tracked.observed_at)
      from ship_positions tracked
      where tracked.mmsi in (select mmsi from candidate_ships)
    ), '[]'::jsonb),
    'vessels', coalesce((
      select jsonb_agg(jsonb_build_object('mmsi', vessel.mmsi, 'name', vessel.name, 'shipType', vessel.ship_type, 'draughtMetres', vessel.draught_metres))
      from public.vessels vessel
      where vessel.mmsi in (select mmsi from near_ships)
    ), '[]'::jsonb),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object('name', affected.name, 'kind', affected.kind, 'route', extensions.st_asgeojson(affected.route::extensions.geometry, 6)::jsonb))
      from affected
    ), '[]'::jsonb),
    'passersBy', coalesce((
      select jsonb_agg(jsonb_build_array(passer.mmsi, floor(extract(epoch from passer.observed_at)), round(passer.distance_metres::numeric), passer.speed_knots) order by passer.mmsi)
      from passers passer
    ), '[]'::jsonb)
  );
$$;

-- Stores one call's work in one transaction, so a failed call leaves nothing half written and the next call redoes it.
-- run: {source, processedIds: [externalId], signals: [FaultSignal], matches: [{externalId, cableId, basis,
-- distanceMetres, opensDraft}], drafts: [{externalId, cableId, faultNotBeforeMs, faultNotAfterMs, windowFromMs,
-- windowToMs, nearMetres, shipCount, ships}]}. A draft whose cable has a draft with a fault span within a day joins it
-- and replaces its ranking only when its own span is tighter; a country match never opens a draft, it joins the draft
-- of its cable within a day, now or when one opens later. Returns the counts.
create or replace function public.store_fault_run(run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_source text := run ->> 'source';
  incoming jsonb;
  incoming_signal_id bigint;
  incoming_cable_id bigint;
  incoming_not_before timestamptz;
  incoming_not_after timestamptz;
  draft_id bigint;
  draft_span interval;
  signals_stored integer := 0;
  drafts_opened integer := 0;
  drafts_reranked integer := 0;
  signals_joined integer := 0;
  joined_now integer := 0;
begin
  -- One writer at a time, so two overlapping calls cannot open the same draft twice.
  perform pg_advisory_xact_lock(hashtext('public.store_fault_run'));

  for incoming in select value from jsonb_array_elements(coalesce(run -> 'signals', '[]'::jsonb)) loop
    if incoming ->> 'source' is distinct from run_source then
      raise exception 'store_fault_run: a signal of source % in a run of source %', incoming ->> 'source', run_source;
    end if;
    insert into public.fault_signals (source, external_id, kind, title, fault_not_before, fault_not_after, published_at, ends_at, locator, cable_ship, source_url, excerpt)
    values (
      run_source,
      incoming ->> 'externalId',
      incoming ->> 'kind',
      left(incoming ->> 'title', 500),
      to_timestamp((incoming ->> 'faultNotBeforeMs')::double precision / 1000),
      to_timestamp((incoming ->> 'faultNotAfterMs')::double precision / 1000),
      to_timestamp((incoming ->> 'publishedAtMs')::double precision / 1000),
      to_timestamp((incoming ->> 'endsAtMs')::double precision / 1000),
      incoming -> 'locator',
      nullif(incoming ->> 'cableShip', ''),
      incoming ->> 'sourceUrl',
      left(coalesce(incoming ->> 'excerpt', ''), 2000)
    )
    on conflict (source, external_id) do update set
      title = excluded.title,
      ends_at = excluded.ends_at,
      excerpt = excluded.excerpt;
    signals_stored := signals_stored + 1;
  end loop;

  insert into public.fault_signal_matches (signal_id, cable_id, basis, distance_metres)
  select signal.id, (match ->> 'cableId')::bigint, match ->> 'basis', (match ->> 'distanceMetres')::real
  from jsonb_array_elements(coalesce(run -> 'matches', '[]'::jsonb)) as match
  join public.fault_signals signal on signal.source = run_source and signal.external_id = match ->> 'externalId'
  join public.cables cable on cable.id = (match ->> 'cableId')::bigint
  on conflict (signal_id, cable_id) do nothing;

  for incoming in select value from jsonb_array_elements(coalesce(run -> 'drafts', '[]'::jsonb)) loop
    select signal.id into incoming_signal_id
    from public.fault_signals signal
    where signal.source = run_source and signal.external_id = incoming ->> 'externalId';
    if incoming_signal_id is null then
      raise exception 'store_fault_run: a draft for signal % that the run does not store', incoming ->> 'externalId';
    end if;
    incoming_cable_id := (incoming ->> 'cableId')::bigint;
    incoming_not_before := to_timestamp((incoming ->> 'faultNotBeforeMs')::double precision / 1000);
    incoming_not_after := to_timestamp((incoming ->> 'faultNotAfterMs')::double precision / 1000);
    draft_id := null;
    select existing.id, existing.fault_not_after - existing.fault_not_before into draft_id, draft_span
    from public.draft_cases existing
    where existing.cable_id = incoming_cable_id
      and existing.fault_not_before <= incoming_not_after + interval '24 hours'
      and incoming_not_before <= existing.fault_not_after + interval '24 hours'
    order by existing.opened_at desc
    limit 1;
    if draft_id is null then
      insert into public.draft_cases (cable_id, fault_not_before, fault_not_after, window_start, window_end, near_metres, ship_count, ranked_ships, ranking_signal_id)
      values (
        incoming_cable_id, incoming_not_before, incoming_not_after,
        to_timestamp((incoming ->> 'windowFromMs')::double precision / 1000),
        to_timestamp((incoming ->> 'windowToMs')::double precision / 1000),
        (incoming ->> 'nearMetres')::real,
        (incoming ->> 'shipCount')::integer,
        incoming -> 'ships',
        incoming_signal_id
      )
      returning id into draft_id;
      drafts_opened := drafts_opened + 1;
      -- Country matches stored before this draft opened join it now.
      insert into public.draft_case_signals (draft_case_id, signal_id)
      select draft_id, signal.id
      from public.fault_signal_matches match
      join public.fault_signals signal on signal.id = match.signal_id
      where match.cable_id = incoming_cable_id
        and match.basis = 'country'
        and signal.fault_not_before <= incoming_not_after + interval '24 hours'
        and incoming_not_before <= signal.fault_not_after + interval '24 hours'
      on conflict do nothing;
      get diagnostics joined_now = row_count;
      signals_joined := signals_joined + joined_now;
    elsif incoming_not_after - incoming_not_before < draft_span then
      update public.draft_cases set
        fault_not_before = incoming_not_before,
        fault_not_after = incoming_not_after,
        window_start = to_timestamp((incoming ->> 'windowFromMs')::double precision / 1000),
        window_end = to_timestamp((incoming ->> 'windowToMs')::double precision / 1000),
        near_metres = (incoming ->> 'nearMetres')::real,
        ship_count = (incoming ->> 'shipCount')::integer,
        ranked_ships = incoming -> 'ships',
        ranking_signal_id = incoming_signal_id,
        updated_at = now()
      where id = draft_id;
      drafts_reranked := drafts_reranked + 1;
    end if;
    insert into public.draft_case_signals (draft_case_id, signal_id) values (draft_id, incoming_signal_id) on conflict do nothing;
    update public.draft_cases set updated_at = now() where id = draft_id;
  end loop;

  -- Country matches of this run join the drafts already open for their cables.
  insert into public.draft_case_signals (draft_case_id, signal_id)
  select distinct open_draft.id, signal.id
  from jsonb_array_elements(coalesce(run -> 'matches', '[]'::jsonb)) as match
  join public.fault_signals signal on signal.source = run_source and signal.external_id = match ->> 'externalId'
  join public.draft_cases open_draft on open_draft.cable_id = (match ->> 'cableId')::bigint
    and open_draft.fault_not_before <= signal.fault_not_after + interval '24 hours'
    and signal.fault_not_before <= open_draft.fault_not_after + interval '24 hours'
  where match ->> 'basis' = 'country'
  on conflict do nothing;
  get diagnostics joined_now = row_count;
  signals_joined := signals_joined + joined_now;

  insert into public.fault_signals_seen (source, external_id)
  select run_source, processed.external_id
  from jsonb_array_elements_text(coalesce(run -> 'processedIds', '[]'::jsonb)) as processed (external_id)
  on conflict do nothing;

  return jsonb_build_object('signalsStored', signals_stored, 'draftsOpened', drafts_opened, 'draftsReranked', drafts_reranked, 'signalsJoined', signals_joined);
end;
$$;

-- The signals of one draft for the public functions, newest first, at most `max_signals`.
create or replace function public.draft_case_signal_list(target_draft_id bigint, max_signals integer, with_excerpt boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(listed.item order by listed.published_at desc), '[]'::jsonb)
  from (
    select signal.published_at, jsonb_build_object(
      'id', signal.id,
      'source', signal.source,
      'kind', signal.kind,
      'title', signal.title,
      'faultNotBefore', signal.fault_not_before,
      'faultNotAfter', signal.fault_not_after,
      'publishedAt', signal.published_at,
      'sourceUrl', signal.source_url,
      'cableShip', signal.cable_ship
    ) || case when with_excerpt then jsonb_build_object('excerpt', signal.excerpt) else '{}'::jsonb end as item
    from public.draft_case_signals link
    join public.fault_signals signal on signal.id = link.signal_id
    where link.draft_case_id = target_draft_id
    order by signal.published_at desc
    limit greatest(1, least(max_signals, 20))
  ) listed;
$$;

-- The newest draft cases updated in the last `since_days` (1 to 365), for the site with the publishable key. Anyone can
-- call it, so one call stays small: at most 20 drafts, each with its first 3 ranked ships (without their sentences)
-- and its 5 newest signals (without excerpts). draft_case_detail returns one draft in full.
create or replace function public.recent_draft_cases(since_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id,
    'status', recent.status,
    'cableName', recent.cable_name,
    'cableKind', recent.cable_kind,
    'faultNotBefore', recent.fault_not_before,
    'faultNotAfter', recent.fault_not_after,
    'windowStart', recent.window_start,
    'windowEnd', recent.window_end,
    'nearMetres', recent.near_metres,
    'shipCount', recent.ship_count,
    'openedAt', recent.opened_at,
    'updatedAt', recent.updated_at,
    'topShips', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'rank', ship -> 'rank',
        'mmsi', ship -> 'mmsi',
        'name', ship -> 'name',
        'basis', ship -> 'basis',
        'level', ship -> 'level',
        'score', ship -> 'score',
        'closestApproachMetres', ship -> 'closestApproachMetres'
      ) order by (ship ->> 'rank')::integer), '[]'::jsonb)
      from jsonb_array_elements(recent.ranked_ships) as ship
      where (ship ->> 'rank')::integer <= 3
    ),
    'signals', public.draft_case_signal_list(recent.id, 5, false)
  ) order by recent.fault_not_before desc), '[]'::jsonb)
  from (
    select draft.*, cable.name as cable_name, cable.kind as cable_kind
    from public.draft_cases draft
    join public.cables cable on cable.id = draft.cable_id
    where draft.updated_at > now() - make_interval(days => greatest(1, least(since_days, 365)))
    order by draft.fault_not_before desc
    limit 20
  ) recent;
$$;

-- One draft case in full: every ranked ship (at most 20) with its sentences, and its signals (at most 20) with their
-- excerpts; null when no draft has that id.
create or replace function public.draft_case_detail(draft_case_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', draft.id,
    'status', draft.status,
    'cableName', cable.name,
    'cableKind', cable.kind,
    'faultNotBefore', draft.fault_not_before,
    'faultNotAfter', draft.fault_not_after,
    'windowStart', draft.window_start,
    'windowEnd', draft.window_end,
    'nearMetres', draft.near_metres,
    'shipCount', draft.ship_count,
    'openedAt', draft.opened_at,
    'updatedAt', draft.updated_at,
    'rankingSignalId', draft.ranking_signal_id,
    'ships', draft.ranked_ships,
    'signals', public.draft_case_signal_list(draft.id, 20, true)
  )
  from public.draft_cases draft
  join public.cables cable on cable.id = draft.cable_id
  where draft.id = draft_case_id;
$$;

-- The newest stored signals of the last `since_days` (1 to 90), each with the cables it matched, for the site. At most
-- 50 rows, without excerpts.
create or replace function public.recent_fault_signals(since_days integer default 7)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id,
    'source', recent.source,
    'kind', recent.kind,
    'title', recent.title,
    'faultNotBefore', recent.fault_not_before,
    'faultNotAfter', recent.fault_not_after,
    'publishedAt', recent.published_at,
    'endsAt', recent.ends_at,
    'sourceUrl', recent.source_url,
    'cableShip', recent.cable_ship,
    'cables', (
      select coalesce(jsonb_agg(jsonb_build_object('name', cable.name, 'basis', matched.basis, 'distanceMetres', matched.distance_metres) order by cable.name), '[]'::jsonb)
      from public.fault_signal_matches matched
      join public.cables cable on cable.id = matched.cable_id
      where matched.signal_id = recent.id
    ),
    'draftCaseIds', (
      select coalesce(jsonb_agg(link.draft_case_id order by link.draft_case_id), '[]'::jsonb)
      from public.draft_case_signals link
      where link.signal_id = recent.id
    )
  ) order by recent.published_at desc), '[]'::jsonb)
  from (
    select stored.*
    from public.fault_signals stored
    where stored.published_at > now() - make_interval(days => greatest(1, least(since_days, 90)))
    order by stored.published_at desc
    limit 50
  ) recent;
$$;

-- Only the edge function (service role) reads its inputs and writes; everyone may read the capped summaries.
revoke execute on function public.unseen_fault_signal_ids(text, text[]) from public, anon, authenticated;
revoke execute on function public.fault_match_inputs(boolean) from public, anon, authenticated;
revoke execute on function public.fault_case_inputs(bigint, timestamptz, timestamptz, double precision) from public, anon, authenticated;
revoke execute on function public.store_fault_run(jsonb) from public, anon, authenticated;
revoke execute on function public.draft_case_signal_list(bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.unseen_fault_signal_ids(text, text[]) to service_role;
grant execute on function public.fault_match_inputs(boolean) to service_role;
grant execute on function public.fault_case_inputs(bigint, timestamptz, timestamptz, double precision) to service_role;
grant execute on function public.store_fault_run(jsonb) to service_role;
revoke execute on function public.recent_draft_cases(integer) from public;
revoke execute on function public.draft_case_detail(bigint) from public;
revoke execute on function public.recent_fault_signals(integer) from public;
grant execute on function public.recent_draft_cases(integer) to anon, authenticated;
grant execute on function public.draft_case_detail(bigint) to anon, authenticated;
grant execute on function public.recent_fault_signals(integer) to anon, authenticated;
