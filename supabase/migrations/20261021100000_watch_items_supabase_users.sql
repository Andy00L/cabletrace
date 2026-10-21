-- Accounts moved from Clerk to Supabase Auth on 21 Oct 2026 (Andy: email and password). Watchlists now key on Supabase
-- Auth user ids, lowercase UUIDs (src/lib/watchlist/watch-items.ts holds the same pattern). Rows written under Clerk
-- ids stay valid and untouched: no session can name them any more, and nothing is deleted.

alter table public.watch_items drop constraint watch_items_user_id_check;

alter table public.watch_items add constraint watch_items_user_id_check check (
  user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or user_id ~ '^user_[A-Za-z0-9]{1,60}$'
);
