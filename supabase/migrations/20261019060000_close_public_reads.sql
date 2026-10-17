-- Closes the two ways a stranger could drain the free plan's 5 GB of monthly egress (security review, 17 Oct 2026):
-- 1. The recorder's tables were readable in full with the publishable key (open select policies from
--    20261017020000_live_recorder.sql): paging through 14 days of vessel_positions moves about 283 KB per 1,000 rows.
--    The app never reads them directly; every public read goes through a capped security definer function.
-- 2. The ship-frames bucket was public, so frames (160 to 175 KB each) could be downloaded straight from Storage,
--    around the CDN. The /api/ship-frames route now reads it on the server with the secret key, behind Vercel's cache.

drop policy if exists "Cables are readable by everyone" on public.cables;
drop policy if exists "Vessels are readable by everyone" on public.vessels;
drop policy if exists "Vessel positions are readable by everyone" on public.vessel_positions;
drop policy if exists "Recorder runs are readable by everyone" on public.recorder_runs;

-- The home page and /api/health keep their one-call summary: it now runs as its owner (it returned only aggregates
-- already) and says that the last run failed without publishing the database's error text.
create or replace function public.recorder_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with last_run as (
    select ran_at, error from public.recorder_runs order by id desc limit 1
  ),
  last_hour as (
    select count(*) as position_count, count(distinct mmsi) as ship_count
    from public.vessel_positions
    where observed_at > now() - interval '1 hour'
  )
  select jsonb_build_object(
    'checkedAt', now(),
    'lastRunAt', (select ran_at from last_run),
    'lastRunError', (select case when error is null then null else 'the last recorder run failed' end from last_run),
    'positionsLastHour', (select position_count from last_hour),
    'shipsLastHour', (select ship_count from last_hour),
    'cablesWatched', (select count(*) from public.cables)
  );
$$;

revoke execute on function public.recorder_summary() from public;
grant execute on function public.recorder_summary() to anon, authenticated;

-- No storage.objects policy grants anon or authenticated a read on this bucket, so private means server-only.
update storage.buckets set public = false where id = 'ship-frames';

-- A reader with a full watchlist who presses Watch on something already watched gets "already watched", not "full":
-- the duplicate passes this trigger and the unique constraint answers it.
create or replace function public.enforce_watch_item_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('watch_items:' || new.user_id, 0));
  if exists (select 1 from public.watch_items where user_id = new.user_id and kind = new.kind and ref = new.ref) then
    return new;
  end if;
  if (select count(*) from public.watch_items where user_id = new.user_id) >= 100 then
    raise exception 'watch item limit reached' using errcode = 'P0001', hint = 'watch-limit';
  end if;
  return new;
end;
$$;
