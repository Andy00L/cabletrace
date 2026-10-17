-- Schedules for the fault-signal matcher (supabase/functions/match-fault-signals). The function address and its
-- shared secret live in Supabase Vault (names fault_signals_function_url and fault_signals_secret, added before this
-- migration runs), never in this file. The body says which source a call polls. The minutes stay clear of the ship
-- frame collector (every 10 minutes from :00, about 110 s each) and the detector (:04 and :34).

-- NGA navigational warnings, hourly: the feed changes a few times a day at most (its newest warning was dated
-- 10 May 2024 when this was written, docs/FAULT_SIGNALS.md).
select cron.schedule(
  'match-fault-signals-nga',
  '13 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fault-signals-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_secret')
    ),
    body := '{"sources": ["nga"]}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- IODA outage alerts, every 15 minutes: each call reads the last 30 minutes of every country's alerts.
select cron.schedule(
  'match-fault-signals-ioda',
  '7,22,37,52 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fault-signals-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_secret')
    ),
    body := '{"sources": ["ioda"]}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ENTSO-E forced outages of power links, hourly. Until the function secret ENTSO_E_TOKEN exists the call returns at
-- once with "skipped" and reads nothing from the database.
select cron.schedule(
  'match-fault-signals-entsoe',
  '43 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fault-signals-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fault_signals_secret')
    ),
    body := '{"sources": ["entsoe"]}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Daily: an internet outage signal that joined no draft in 7 days goes (a country alone opens no draft), and processed
-- ids are forgotten after 30 days (an NGA warning still active then is matched once more, which stores nothing new).
select cron.schedule(
  'prune-fault-signals',
  '53 3 * * *',
  $$
  delete from public.fault_signals stale
  where stale.source = 'ioda-alert'
    and stale.first_seen_at < now() - interval '7 days'
    and not exists (select 1 from public.draft_case_signals link where link.signal_id = stale.id);
  delete from public.fault_signals_seen where seen_at < now() - interval '30 days';
  $$
);
