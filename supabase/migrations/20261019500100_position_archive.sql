-- Cold storage for recorded positions, so eight regions fit the free plan's 500 MB database. The hot table keeps each
-- region's hot window (72 hours; 47 for aisstream regions, public.watched_regions.hot_retention_hours). The recorder's
-- daily archive task (supabase/functions/record-vessel-positions/archive.ts) writes every complete UTC day of the
-- archived regions to a gzip file in the private bucket position-archive, kept 30 days, and every alert's ship track to
-- a file kept forever; the hourly prune drops a past day from the hot table once its file is recorded here. Layout:
-- src/lib/regions/archive-layout.ts. Sizes and the budget: docs/REGIONS.md.
--
-- Rollback: `select cron.unschedule('archive-vessel-positions');`, then re-run the 14-day 'prune-vessel-positions'
-- schedule of 20261017040000_thin_stationary_positions.sql; `drop function public.prune_vessel_positions(),
-- public.pending_archive_days(integer), public.position_archive_document(text, date), public.pending_archive_tracks(integer),
-- public.track_archive_document(bigint), public.record_position_archive(jsonb), public.expired_position_archives(integer),
-- public.forget_position_archives(text[]); drop table public.position_archives;` The bucket and its files stay until
-- emptied and deleted in the dashboard (Storage refuses to drop a bucket that holds files).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('position-archive', 'position-archive', false, 52428800, array['application/gzip'])
on conflict (id) do nothing;

-- One row per archive file; a 'day' row is what lets the prune drop that day from the hot table.
create table public.position_archives (
  object_path text primary key,
  region_id text not null references public.watched_regions (id),
  kind text not null check (kind in ('day', 'detection')),
  day date,
  -- An alert with a kept track cannot be deleted while this row names it.
  detection_id bigint references public.detections (id),
  row_count integer not null check (row_count >= 0),
  byte_count integer not null check (byte_count >= 0),
  created_at timestamptz not null default now(),
  check ((kind = 'day' and day is not null and detection_id is null) or (kind = 'detection' and detection_id is not null and day is null))
);
create unique index position_archives_day_index on public.position_archives (region_id, day) where kind = 'day';
create unique index position_archives_detection_index on public.position_archives (detection_id) where kind = 'detection';
-- No policy: only the recorder (service role) reads and writes it.
alter table public.position_archives enable row level security;

-- Columns of every archived row, in the order of `rows` (the file's own `columns` repeats them).
-- [mmsi, epoch seconds, longitude, latitude, speed knots, course, heading, navigational status, rate of turn code,
--  nearest cable id, metres to that cable]; unreported values are null.

-- Complete UTC days of archived regions that still have rows in the hot table and no file yet, oldest first.
create or replace function public.pending_archive_days(max_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('regionId', pending.region_id, 'day', to_char(pending.day, 'YYYY-MM-DD')) order by pending.day, pending.region_id), '[]'::jsonb)
  from (
    select distinct cable.region_id, (position_row.observed_at at time zone 'UTC')::date as day
    from public.vessel_positions as position_row
    join public.cables as cable on cable.id = position_row.nearest_cable_id
    join public.watched_regions as region on region.id = cable.region_id and region.is_archived
    where (position_row.observed_at at time zone 'UTC')::date < (now() at time zone 'UTC')::date
      and not exists (
        select 1 from public.position_archives as archive
        where archive.kind = 'day' and archive.region_id = cable.region_id and archive.day = (position_row.observed_at at time zone 'UTC')::date
      )
    order by day, cable.region_id
    limit greatest(0, least(max_days, 31))
  ) as pending;
$$;

-- One region's UTC day as an archive document.
create or replace function public.position_archive_document(target_region_id text, target_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with day_rows as (
    select position_row.*
    from public.vessel_positions as position_row
    join public.cables as cable on cable.id = position_row.nearest_cable_id
    where cable.region_id = target_region_id
      and position_row.observed_at >= target_day::timestamp at time zone 'UTC'
      and position_row.observed_at < (target_day + 1)::timestamp at time zone 'UTC'
  )
  select jsonb_build_object(
    'version', 1,
    'kind', 'day',
    'regionId', target_region_id,
    'day', to_char(target_day, 'YYYY-MM-DD'),
    'columns', jsonb_build_array('mmsi', 'epochSeconds', 'longitude', 'latitude', 'speedKnots', 'courseDegrees', 'headingDegrees', 'navigationStatus', 'turnRate', 'cableId', 'cableDistanceMetres'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(
        day_row.mmsi,
        floor(extract(epoch from day_row.observed_at)),
        round(extensions.st_x(day_row.position::extensions.geometry)::numeric, 5),
        round(extensions.st_y(day_row.position::extensions.geometry)::numeric, 5),
        day_row.speed_knots,
        day_row.course_degrees,
        day_row.heading_degrees,
        day_row.navigation_status,
        day_row.turn_rate,
        day_row.nearest_cable_id,
        round(day_row.cable_distance_metres::numeric, 0)
      ) order by day_row.mmsi, day_row.observed_at)
      from day_rows as day_row
    ), '[]'::jsonb),
    'rowCount', (select count(*) from day_rows),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object('id', cable.id, 'name', cable.name, 'kind', cable.kind, 'source', cable.source) order by cable.id)
      from public.cables as cable
      where cable.id in (select nearest_cable_id from day_rows)
    ), '[]'::jsonb)
  );
$$;

-- Alerts whose track is complete (3 hours after the window, REFERENCE_AFTER_MS in src/lib/detection/drag-rules.ts),
-- not kept yet, in an archived region (the region of the ship's first position in the window), oldest first.
create or replace function public.pending_archive_tracks(max_tracks integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('detectionId', pending.id, 'regionId', pending.region_id) order by pending.id), '[]'::jsonb)
  from (
    select detection.id, first_position.region_id
    from public.detections as detection
    cross join lateral (
      select cable.region_id
      from public.vessel_positions as position_row
      join public.cables as cable on cable.id = position_row.nearest_cable_id
      where position_row.mmsi = detection.mmsi and position_row.observed_at between detection.start_at and detection.end_at
      order by position_row.observed_at
      limit 1
    ) as first_position
    join public.watched_regions as region on region.id = first_position.region_id and region.is_archived
    where detection.level = 'alert'
      and detection.end_at < now() - interval '3 hours'
      and not exists (select 1 from public.position_archives as archive where archive.detection_id = detection.id)
    order by detection.id
    limit greatest(0, least(max_tracks, 100))
  ) as pending;
$$;

-- An alert's ship track, its window plus 3 hours either side, from archived regions only (aisstream data is not kept).
create or replace function public.track_archive_document(target_detection_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with detection as (
    select * from public.detections where id = target_detection_id
  ),
  track_rows as (
    select position_row.*
    from detection
    join public.vessel_positions as position_row
      on position_row.mmsi = detection.mmsi
      and position_row.observed_at between detection.start_at - interval '3 hours' and detection.end_at + interval '3 hours'
    join public.cables as cable on cable.id = position_row.nearest_cable_id
    join public.watched_regions as region on region.id = cable.region_id and region.is_archived
  )
  select jsonb_build_object(
    'version', 1,
    'kind', 'detection',
    'detectionId', detection.id,
    'mmsi', detection.mmsi,
    'level', detection.level,
    'score', detection.score,
    'startAt', detection.start_at,
    'endAt', detection.end_at,
    'columns', jsonb_build_array('mmsi', 'epochSeconds', 'longitude', 'latitude', 'speedKnots', 'courseDegrees', 'headingDegrees', 'navigationStatus', 'turnRate', 'cableId', 'cableDistanceMetres'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(
        track_row.mmsi,
        floor(extract(epoch from track_row.observed_at)),
        round(extensions.st_x(track_row.position::extensions.geometry)::numeric, 5),
        round(extensions.st_y(track_row.position::extensions.geometry)::numeric, 5),
        track_row.speed_knots,
        track_row.course_degrees,
        track_row.heading_degrees,
        track_row.navigation_status,
        track_row.turn_rate,
        track_row.nearest_cable_id,
        round(track_row.cable_distance_metres::numeric, 0)
      ) order by track_row.observed_at)
      from track_rows as track_row
    ), '[]'::jsonb),
    'rowCount', (select count(*) from track_rows)
  )
  from detection;
$$;

-- Records a written file. Each entry: {objectPath, regionId, kind, day, detectionId, rowCount, byteCount} (ArchiveEntry
-- in supabase/functions/record-vessel-positions/archive.ts). Writing a file again replaces its row.
create or replace function public.record_position_archive(entry jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.position_archives (object_path, region_id, kind, day, detection_id, row_count, byte_count)
  values (
    entry ->> 'objectPath',
    entry ->> 'regionId',
    entry ->> 'kind',
    (entry ->> 'day')::date,
    (entry ->> 'detectionId')::bigint,
    (entry ->> 'rowCount')::integer,
    (entry ->> 'byteCount')::integer
  )
  on conflict (object_path) do update set row_count = excluded.row_count, byte_count = excluded.byte_count, created_at = now();
$$;

-- Day files older than `retention_days` (ARCHIVE_DAY_RETENTION_DAYS); alert tracks never expire.
create or replace function public.expired_position_archives(retention_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(archive.object_path order by archive.object_path), '[]'::jsonb)
  from public.position_archives as archive
  where archive.kind = 'day' and archive.day < (now() at time zone 'UTC')::date - greatest(1, retention_days);
$$;

-- Forgets day files the archive task deleted from Storage; returns how many rows went.
create or replace function public.forget_position_archives(object_paths text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with forgotten as (
    delete from public.position_archives where kind = 'day' and object_path = any (object_paths) returning 1
  )
  select count(*)::integer from forgotten;
$$;

-- Deletes positions past their region's hot window and returns how many went. Regions whose feeds cap retention
-- (aisstream: 47 hours) lose them on time, archived or not. An archived region keeps a past day until its file is
-- recorded above; 14 days, the retention the table had before (20261017040000_thin_stationary_positions.sql), is the
-- backstop when archiving fails.
create or replace function public.prune_vessel_positions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.vessel_positions as position_row
  using public.cables as cable, public.watched_regions as region
  where cable.id = position_row.nearest_cable_id
    and region.id = cable.region_id
    and position_row.observed_at < now() - make_interval(hours => region.hot_retention_hours)
    and (
      not region.is_archived
      or position_row.observed_at < now() - interval '14 days'
      or exists (
        select 1
        from public.position_archives as archive
        where archive.kind = 'day'
          and archive.region_id = region.id
          and archive.day = (position_row.observed_at at time zone 'UTC')::date
      )
    );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.pending_archive_days(integer) from public, anon, authenticated;
revoke execute on function public.position_archive_document(text, date) from public, anon, authenticated;
revoke execute on function public.pending_archive_tracks(integer) from public, anon, authenticated;
revoke execute on function public.track_archive_document(bigint) from public, anon, authenticated;
revoke execute on function public.record_position_archive(jsonb) from public, anon, authenticated;
revoke execute on function public.expired_position_archives(integer) from public, anon, authenticated;
revoke execute on function public.forget_position_archives(text[]) from public, anon, authenticated;
revoke execute on function public.prune_vessel_positions() from public, anon, authenticated;
grant execute on function public.pending_archive_days(integer) to service_role;
grant execute on function public.position_archive_document(text, date) to service_role;
grant execute on function public.pending_archive_tracks(integer) to service_role;
grant execute on function public.track_archive_document(bigint) to service_role;
grant execute on function public.record_position_archive(jsonb) to service_role;
grant execute on function public.expired_position_archives(integer) to service_role;
grant execute on function public.forget_position_archives(text[]) to service_role;
grant execute on function public.prune_vessel_positions() to service_role;

-- Hourly instead of daily, so aisstream positions never outlive their 47 hours by more than an hour.
select cron.schedule('prune-vessel-positions', '23 * * * *', $$ select public.prune_vessel_positions(); $$);

-- Daily at 03:41 UTC, after midnight UTC has closed the previous day: the recorder's archive task. Same Vault entries
-- as the minute's recording; pg_net waits up to 120 s (3 days and 20 tracks a run, ARCHIVE_DAYS_PER_RUN and
-- ARCHIVE_TRACKS_PER_RUN in src/lib/regions/archive-layout.ts).
select cron.schedule(
  'archive-vessel-positions',
  '41 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'recorder_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recorder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recorder_secret')
    ),
    body := '{"task":"archive"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
