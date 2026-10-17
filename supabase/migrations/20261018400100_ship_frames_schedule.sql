-- Schedules for the ship frame collector. The function address lives in Supabase Vault (name
-- collector_function_url, added before this migration runs); the shared secret is the recorder's
-- (Vault recorder_secret, function secret RECORDER_SECRET), checked the same way by both functions.

-- Every 10 minutes: listen to aisstream for 105 s, add Digitraffic, write the slot's frame
-- (supabase/functions/collect-ship-frames). One run per slot because each run downloads the newest
-- frame to merge into; the reply comes after about 110 s, so pg_net waits up to the 150 s wall clock.
select cron.schedule(
  'collect-ship-frames',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'collector_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recorder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recorder_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Hourly: static rows not refreshed for 47 hours go, so none is older than 2 days (the aisstream rule).
select cron.schedule(
  'prune-live-ships',
  '47 * * * *',
  $$ delete from public.live_ships where updated_at < now() - interval '47 hours'; $$
);
