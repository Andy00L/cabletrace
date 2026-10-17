-- Schedules for the live recorder. The function address and its shared secret live in
-- Supabase Vault (names recorder_function_url and recorder_secret), never in this file.

-- Every minute: ask the recorder function to fetch and store the latest Digitraffic positions.
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
    timeout_milliseconds := 25000
  );
  $$
);

-- Daily: keep 30 days of positions (the free plan holds 500 MB; the research estimate is about 220 MB
-- for 30 days of near-cable positions) and 7 days of run logs.
select cron.schedule(
  'prune-vessel-positions',
  '17 3 * * *',
  $$ delete from public.vessel_positions where observed_at < now() - interval '30 days'; $$
);
select cron.schedule(
  'prune-recorder-runs',
  '27 3 * * *',
  $$ delete from public.recorder_runs where ran_at < now() - interval '7 days'; $$
);
