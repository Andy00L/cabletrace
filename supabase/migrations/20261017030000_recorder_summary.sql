-- One-call summary of the live recorder, read by the home page and /api/health with the publishable key.
-- Runs as the caller (security invoker), so it sees only what row level security already lets anyone read.
create or replace function public.recorder_summary()
returns jsonb
language sql
stable
security invoker
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
    'lastRunError', (select error from last_run),
    'positionsLastHour', (select position_count from last_hour),
    'shipsLastHour', (select ship_count from last_hour),
    'cablesWatched', (select count(*) from public.cables)
  );
$$;

grant execute on function public.recorder_summary() to anon, authenticated;
