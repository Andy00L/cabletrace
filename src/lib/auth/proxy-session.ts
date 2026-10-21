import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readReaderFromClaims, readSupabaseKeys, SESSION_COOKIE_OPTIONS } from "@/lib/auth/supabase-keys";

// The session as the proxy sees it (src/proxy.ts): verified, and refreshed when its token is about to expire.
// sourceRef: node_modules/@supabase/ssr/dist/main/types.d.ts (SetAllCookies) and the Supabase SSR guide for Next.js.

export type ProxySession = {
  readerId: string | null;
  /** Lets the request through, carrying any refreshed cookies to the page and to the browser. */
  response: NextResponse;
};

/**
 * Reads the request's session. A token near its end is refreshed here, once per request, so the page and the data
 * APIs behind it all see a valid one; the project signs tokens with an asymmetric key (ES256), so verifying one
 * needs no call to Supabase once its public key is cached (10 minutes).
 */
export async function readProxySession(request: NextRequest): Promise<ProxySession> {
  let response = NextResponse.next({ request });
  const keys = readSupabaseKeys();
  if (!keys.ok) {
    console.error(`[readProxySession] ${keys.reason}`);
    return { readerId: null, response };
  }
  const supabase = createServerClient(keys.value.url, keys.value.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        // The refreshed cookies go to this request's page (request cookies) and to the browser (response cookies),
        // with the library's no-store headers so no cache keeps one reader's session for another.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([headerName, headerValue]) => response.headers.set(headerName, headerValue));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  return { readerId: readReaderFromClaims(data?.claims)?.id ?? null, response };
}

/** Copies the session's cookie writes (a refresh, or the removal of a dead session) onto another response. */
export function carrySessionCookies(session: ProxySession, target: NextResponse): NextResponse {
  const sessionCookies = session.response.cookies.getAll();
  sessionCookies.forEach((cookie) => target.cookies.set(cookie));
  if (sessionCookies.length > 0) target.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return target;
}
