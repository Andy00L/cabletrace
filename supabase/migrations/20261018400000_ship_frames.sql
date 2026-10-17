-- Daily ship traffic for the /live globe: the public bucket that holds the ship frames and the table of
-- ship names and sizes, both written by the collect-ship-frames edge function.
-- Sources: aisstream.io (no terms published; the owner's rule is to keep nothing older than 2 days and
-- to credit "aisstream.io") and Fintraffic Digitraffic (CC BY 4.0, credit "Fintraffic / digitraffic.fi").
-- Additive only: nothing created by earlier migrations is changed.

-- Frames are public: the browser fetches them straight from Storage (no Vercel function in between,
-- whose free plan carries 10 GB a month). Layout and formats: src/lib/live/frame-layout.ts.
-- A frame of 30,000 ships is about 450 KB compressed; 5 MB leaves room without allowing anything large.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ship-frames', 'ship-frames', true, 5242880, array['application/octet-stream', 'application/json'])
on conflict (id) do nothing;

-- Latest static data per ship, from AIS messages 5, 19 and 24 (aisstream) and Digitraffic vessel
-- metadata. Rows not refreshed for 47 hours are deleted (20261018400100_ship_frames_schedule.sql).
create table public.live_ships (
  mmsi integer primary key check (mmsi between 1 and 999999999),
  name text,
  call_sign text,
  imo integer,
  ship_type smallint,
  length_metres smallint,
  beam_metres smallint,
  draught_metres real,
  destination text,
  source text not null check (source in ('aisstream', 'digitraffic')),
  updated_at timestamptz not null default now()
);
create index live_ships_updated_at_index on public.live_ships (updated_at);

-- No policy: nobody reads the table directly. The page asks live_ship_details for the ships it shows,
-- which keeps the whole table from being pulled through the Data API in one request.
alter table public.live_ships enable row level security;

-- Inserts or refreshes static data and returns how many rows changed. Each ship:
-- {mmsi, name, callSign, imo, shipType, lengthMetres, beamMetres, draughtMetres, destination, source}
-- (ShipStatic in src/lib/live/ais-reports.ts). A field sent as null keeps its stored value, because
-- class B ships send their name and their type in separate messages.
create or replace function public.upsert_live_ships(ships jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with parsed as (
    select
      (ship ->> 'mmsi')::integer as mmsi,
      nullif(trim(ship ->> 'name'), '') as name,
      nullif(trim(ship ->> 'callSign'), '') as call_sign,
      nullif((ship ->> 'imo')::integer, 0) as imo,
      (ship ->> 'shipType')::smallint as ship_type,
      (ship ->> 'lengthMetres')::smallint as length_metres,
      (ship ->> 'beamMetres')::smallint as beam_metres,
      (ship ->> 'draughtMetres')::real as draught_metres,
      nullif(trim(ship ->> 'destination'), '') as destination,
      ship ->> 'source' as source,
      entry.position
    from jsonb_array_elements(ships) with ordinality as entry (ship, position)
    where ship ->> 'mmsi' is not null
  ),
  incoming as (
    -- The last entry per ship wins when a batch names a ship twice.
    select distinct on (mmsi) *
    from parsed
    order by mmsi, position desc
  ),
  upserted as (
    insert into public.live_ships as stored (
      mmsi, name, call_sign, imo, ship_type, length_metres, beam_metres, draught_metres, destination, source, updated_at
    )
    select mmsi, name, call_sign, imo, ship_type, length_metres, beam_metres, draught_metres, destination, source, now()
    from incoming
    on conflict (mmsi) do update set
      name = coalesce(excluded.name, stored.name),
      call_sign = coalesce(excluded.call_sign, stored.call_sign),
      imo = coalesce(excluded.imo, stored.imo),
      ship_type = coalesce(excluded.ship_type, stored.ship_type),
      length_metres = coalesce(excluded.length_metres, stored.length_metres),
      beam_metres = coalesce(excluded.beam_metres, stored.beam_metres),
      draught_metres = coalesce(excluded.draught_metres, stored.draught_metres),
      destination = coalesce(excluded.destination, stored.destination),
      source = excluded.source,
      updated_at = now()
    returning 1
  )
  select count(*)::integer from upserted;
$$;

-- AIS ship types of the given ships, for the collector to classify ships whose static message came in
-- an earlier run. Two parallel arrays ({"mmsis": [...], "shipTypes": [...]}) keep the reply small.
create or replace function public.live_ship_types(mmsis integer[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mmsis', coalesce(jsonb_agg(known.mmsi order by known.mmsi), '[]'::jsonb),
    'shipTypes', coalesce(jsonb_agg(known.ship_type order by known.mmsi), '[]'::jsonb)
  )
  from public.live_ships as known
  where known.mmsi = any (mmsis) and known.ship_type > 0;
$$;

-- Name, type and size of up to 200 ships, for the /live page (callable with the publishable key).
-- Security definer because the table has no read policy; the 200-ship cap and the 2-day window are
-- what this function exposes, nothing more.
create or replace function public.live_ship_details(mmsis integer[])
returns table (
  mmsi integer,
  name text,
  call_sign text,
  imo integer,
  ship_type smallint,
  length_metres smallint,
  beam_metres smallint,
  draught_metres real,
  destination text,
  source text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    known.mmsi, known.name, known.call_sign, known.imo, known.ship_type, known.length_metres,
    known.beam_metres, known.draught_metres, known.destination, known.source, known.updated_at
  from public.live_ships as known
  where known.mmsi = any (mmsis[1:200]) and known.updated_at > now() - interval '47 hours';
$$;

-- Only the collector (service role) writes and runs the bulk lookup; everyone may read details.
revoke execute on function public.upsert_live_ships(jsonb) from public, anon, authenticated;
revoke execute on function public.live_ship_types(integer[]) from public, anon, authenticated;
revoke execute on function public.live_ship_details(integer[]) from public;
grant execute on function public.upsert_live_ships(jsonb) to service_role;
grant execute on function public.live_ship_types(integer[]) to service_role;
grant execute on function public.live_ship_details(integer[]) to anon, authenticated;
