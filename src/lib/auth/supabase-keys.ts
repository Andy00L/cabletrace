import type { CookieOptions } from "@supabase/ssr";
import type { Result } from "@/lib/result";

// Supabase Auth runs the accounts (Andy, 21 Oct 2026: email and password, no Google). The server alone reads and
// writes the session: the proxy refreshes it (src/proxy.ts), server actions sign in and out
// (src/lib/auth/account-actions.ts). No browser script touches it.

export type SupabaseKeys = { url: string; publishableKey: string };

/**
 * The session cookies (`sb-<project ref>-auth-token`, split in chunks when long). No browser script reads them, so
 * they are httpOnly; Secure holds on localhost too, which Chromium treats as a secure origin. The rest is the
 * library's default: path "/", SameSite Lax, 400 days.
 * sourceRef: node_modules/@supabase/ssr/dist/main/utils/constants.js (DEFAULT_COOKIE_OPTIONS).
 */
export const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true };

export function readSupabaseKeys(): Result<SupabaseKeys> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL is not set" };
  if (!publishableKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set" };
  return { ok: true, value: { url, publishableKey } };
}

/** The signed-in reader: Supabase's user id (a UUID, the token's `sub`) and the address they signed in with. */
export type Reader = { id: string; email: string | null };

/** The reader a verified token's claims name, or null when they name none. */
export function readReaderFromClaims(claims: { sub?: unknown; email?: unknown } | null | undefined): Reader | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}
