import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Result } from "@/lib/result";
import { readReaderFromClaims, readSupabaseKeys, SESSION_COOKIE_OPTIONS, type Reader } from "@/lib/auth/supabase-keys";

// The session as server components, server actions and route handlers see it, through the request's cookies. The
// proxy (src/proxy.ts) has already refreshed an expiring token before any of them runs.

/** A Supabase client on this request's session cookies; create one per request, never share it. */
export async function createSessionClient(): Promise<Result<SupabaseClient>> {
  const keys = readSupabaseKeys();
  if (!keys.ok) return keys;
  const cookieStore = await cookies();
  const client = createServerClient(keys.value.url, keys.value.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Server actions and route handlers may write cookies; a server component may not, and Next throws there.
        // A component only ever reads a session the proxy refreshed, so a write it skips loses nothing.
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          return;
        }
      },
    },
  });
  return { ok: true, value: client };
}

/** The signed-in reader, from a token verified against the project's signing key; null when signed out. */
export async function readSignedInReader(): Promise<Reader | null> {
  const client = await createSessionClient();
  if (!client.ok) {
    console.error(`[readSignedInReader] ${client.reason}`);
    return null;
  }
  const { data } = await client.value.auth.getClaims();
  return readReaderFromClaims(data?.claims);
}
