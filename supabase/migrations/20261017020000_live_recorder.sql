-- Live recorder: ships seen near Gulf of Finland cables, recorded every minute
-- from Finnish Digitraffic AIS (CC BY 4.0, https://www.digitraffic.fi/en/).

create extension if not exists postgis with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Cable and pipeline routes the recorder watches (seeded by the next migration).
create table public.cables (
  id bigint generated always as identity primary key,
  name text not null,
  kind text not null check (kind in ('power', 'telecom', 'pipeline')),
  source text not null,
  route extensions.geography(MultiLineString, 4326) not null,
  unique (name, kind)
);
create index cables_route_index on public.cables using gist (route);

-- Static vessel data from AIS message 5 (name, type, size, destination).
create table public.vessels (
  mmsi integer primary key,
  name text,
  ship_type smallint,
  call_sign text,
  imo integer,
  destination text,
  draught_metres real,
  updated_at timestamptz not null default now()
);

-- One row per AIS position report within near-cable range. Unavailable AIS values
-- (speed 102.3, course 360, heading 511, rate of turn -128) are stored as null.
create table public.vessel_positions (
  mmsi integer not null,
  observed_at timestamptz not null,
  position extensions.geography(Point, 4326) not null,
  speed_knots real,
  course_degrees real,
  heading_degrees smallint,
  navigation_status smallint,
  turn_rate real,
  nearest_cable_id bigint not null references public.cables (id),
  cable_distance_metres real not null,
  primary key (mmsi, observed_at)
);
create index vessel_positions_observed_at_index on public.vessel_positions (observed_at);
create index vessel_positions_cable_index on public.vessel_positions (nearest_cable_id, observed_at);

-- One row per recorder call, for the status page and for debugging gaps.
create table public.recorder_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  received_count integer not null default 0,
  in_region_count integer not null default 0,
  stored_count integer not null default 0,
  vessels_updated_count integer not null default 0,
  error text
);
create index recorder_runs_ran_at_index on public.recorder_runs (ran_at);

-- Where the next call resumes: the newest report time seen, and the last vessel data refresh.
create table public.recorder_state (
  id smallint primary key default 1 check (id = 1),
  last_report_ms bigint,
  last_vessel_refresh_ms bigint
);
insert into public.recorder_state (id) values (1);

-- Stores the reports that fall within near_cable_metres of a cable and returns how many were new.
-- Each report: {mmsi, reportedAtMs, longitude, latitude, speedKnots, courseDegrees, headingDegrees, navigationStatus, turnRate}.
create or replace function public.ingest_vessel_positions(reports jsonb, near_cable_metres double precision default 3000)
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
      )::extensions.geography as position,
      (report ->> 'speedKnots')::real as speed_knots,
      (report ->> 'courseDegrees')::real as course_degrees,
      (report ->> 'headingDegrees')::smallint as heading_degrees,
      (report ->> 'navigationStatus')::smallint as navigation_status,
      (report ->> 'turnRate')::real as turn_rate
    from jsonb_array_elements(reports) as report
  ),
  matched as (
    select incoming.*, nearest.id as nearest_cable_id, nearest.distance_metres
    from incoming
    cross join lateral (
      select cables.id, extensions.st_distance(cables.route, incoming.position) as distance_metres
      from public.cables
      where extensions.st_dwithin(cables.route, incoming.position, near_cable_metres)
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

-- Inserts or refreshes static vessel data and returns how many rows changed.
-- Each vessel: {mmsi, name, shipType, callSign, imo, destination, draughtMetres}.
create or replace function public.upsert_vessels(vessels jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with incoming as (
    select distinct on ((vessel ->> 'mmsi')::integer)
      (vessel ->> 'mmsi')::integer as mmsi,
      nullif(trim(vessel ->> 'name'), '') as name,
      (vessel ->> 'shipType')::smallint as ship_type,
      nullif(trim(vessel ->> 'callSign'), '') as call_sign,
      nullif((vessel ->> 'imo')::integer, 0) as imo,
      nullif(trim(vessel ->> 'destination'), '') as destination,
      (vessel ->> 'draughtMetres')::real as draught_metres
    from jsonb_array_elements(vessels) as vessel
    where vessel ->> 'mmsi' is not null
  ),
  upserted as (
    insert into public.vessels (mmsi, name, ship_type, call_sign, imo, destination, draught_metres, updated_at)
    select mmsi, name, ship_type, call_sign, imo, destination, draught_metres, now() from incoming
    on conflict (mmsi) do update set
      name = excluded.name,
      ship_type = excluded.ship_type,
      call_sign = excluded.call_sign,
      imo = excluded.imo,
      destination = excluded.destination,
      draught_metres = excluded.draught_metres,
      updated_at = now()
    returning 1
  )
  select count(*)::integer from upserted;
$$;

-- Only the recorder (service role) may write.
revoke execute on function public.ingest_vessel_positions(jsonb, double precision) from public, anon, authenticated;
revoke execute on function public.upsert_vessels(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_vessel_positions(jsonb, double precision) to service_role;
grant execute on function public.upsert_vessels(jsonb) to service_role;

-- Everything recorded is public data (Digitraffic CC BY 4.0, cable routes ODbL and CC BY 4.0): read-only for everyone.
alter table public.cables enable row level security;
alter table public.vessels enable row level security;
alter table public.vessel_positions enable row level security;
alter table public.recorder_runs enable row level security;
alter table public.recorder_state enable row level security;

create policy "Cables are readable by everyone" on public.cables for select to anon, authenticated using (true);
create policy "Vessels are readable by everyone" on public.vessels for select to anon, authenticated using (true);
create policy "Vessel positions are readable by everyone" on public.vessel_positions for select to anon, authenticated using (true);
create policy "Recorder runs are readable by everyone" on public.recorder_runs for select to anon, authenticated using (true);
