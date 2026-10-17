-- Watchlists of signed-in readers: the cases, cables and ships each one follows. Users are Clerk user ids; the app's
-- server is the only client (src/lib/watchlist/watch-store.ts, with the secret key), so row level security is on with
-- no policy and the publishable key can neither read nor write a row.

create table public.watch_items (
  id bigint generated always as identity primary key,
  user_id text not null check (user_id ~ '^user_[A-Za-z0-9]{1,60}$'),
  kind text not null check (kind in ('case', 'cable', 'ship')),
  ref text not null check (char_length(ref) between 1 and 120),
  label text not null check (char_length(label) between 1 and 200),
  created_at timestamptz not null default now(),
  -- Watching the same thing twice is one row; the unique index also serves the per-user listing.
  unique (user_id, kind, ref)
);

alter table public.watch_items enable row level security;
revoke all on public.watch_items from anon, authenticated;

-- At most 100 items per reader (MAX_WATCH_ITEMS in src/lib/watchlist/watch-items.ts), checked under a per-user lock
-- so two adds at the same moment cannot both pass the count.
create or replace function public.enforce_watch_item_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('watch_items:' || new.user_id, 0));
  if (select count(*) from public.watch_items where user_id = new.user_id) >= 100 then
    raise exception 'watch item limit reached' using errcode = 'P0001', hint = 'watch-limit';
  end if;
  return new;
end;
$$;

create trigger watch_items_limit
before insert on public.watch_items
for each row execute function public.enforce_watch_item_limit();
