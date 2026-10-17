-- Keeps the recorder inside the free plan's 500 MB.
-- Measured on 2026-10-17: about 105 stored positions a minute (42 MB a day), 59% of them from ships
-- sitting still in port or at anchor and repeating the same spot.
--
-- A stationary report (under 0.5 knots, or no speed) is now skipped when the same ship already has a
-- stored position less than 10 minutes older and less than 50 m away. A dragging anchor still gets
-- every report: it moves more than 50 m within minutes and usually shows speed. Moving ships keep one
-- position a minute.

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
  worth_storing as (
    select incoming.*
    from incoming
    where not (
      coalesce(incoming.speed_knots, 0) < 0.5
      and exists (
        select 1
        from public.vessel_positions as previous
        where previous.mmsi = incoming.mmsi
          and previous.observed_at <= incoming.observed_at
          and previous.observed_at > incoming.observed_at - interval '10 minutes'
          and extensions.st_dwithin(previous.position, incoming.position, 50)
      )
    )
  ),
  matched as (
    select worth_storing.*, nearest.id as nearest_cable_id, nearest.distance_metres
    from worth_storing
    cross join lateral (
      select cables.id, extensions.st_distance(cables.route, worth_storing.position) as distance_metres
      from public.cables
      where extensions.st_dwithin(cables.route, worth_storing.position, near_cable_metres)
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

-- create or replace keeps the earlier grants; restated so this file reads on its own.
revoke execute on function public.ingest_vessel_positions(jsonb, double precision) from public, anon, authenticated;
grant execute on function public.ingest_vessel_positions(jsonb, double precision) to service_role;

-- 14 days of positions: at the thinned rate (about 20 MB a day) that stays near 300 MB of the 500 MB.
select cron.schedule(
  'prune-vessel-positions',
  '17 3 * * *',
  $$ delete from public.vessel_positions where observed_at < now() - interval '14 days'; $$
);
