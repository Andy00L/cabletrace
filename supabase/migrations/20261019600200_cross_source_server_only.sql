-- The feed check's samples were callable with the publishable key, up to 168 hours and about 150 KB a call, straight
-- from Supabase with no CDN in front (security re-review, 17 Oct 2026): a loop of anonymous calls could spend the free
-- plan's 5 GB of monthly egress. The site now reads them on the server with the secret key
-- (src/lib/health/cross-source-health.ts), behind /api/health's 30 s CDN cache, and /live reads /api/health.
-- Down: grant execute on function public.cross_source_samples_since(integer) to anon, authenticated;
revoke execute on function public.cross_source_samples_since(integer) from anon, authenticated;
grant execute on function public.cross_source_samples_since(integer) to service_role;
