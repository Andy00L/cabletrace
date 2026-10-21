// The session cookies of the tools' test reader, for a browser the tools cannot sign in through the form: the lookdev
// harness's WebGPU tier drives Windows Chrome from the command line (scripts/lookdev/webgpu-capture.ts), and its
// proxy sends these cookies upstream with every request. They are made by signing in with Supabase's own server
// client, so they carry exactly the names and encoding the app reads (src/lib/auth/proxy-session.ts). The password
// and the cookies are never printed.
import { createServerClient } from "@supabase/ssr";
import type { Result } from "../../src/lib/result";
import { readToolsTestPassword, TOOLS_TEST_EMAIL } from "../auth/test-readers";

// Supabase access tokens live an hour (the project default); a new session is opened once half of that has passed,
// so the proxy never sends one the app has to refresh.
const RENEW_AFTER_MS = 30 * 60 * 1000;

/** Signs the test reader in and returns its session cookies as one Cookie header value. */
async function openSession(url: string, publishableKey: string, password: string): Promise<Result<string>> {
  const cookieJar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value }) => (value ? cookieJar.set(name, value) : cookieJar.delete(name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: TOOLS_TEST_EMAIL, password });
  if (error) return { ok: false, reason: `signing in ${TOOLS_TEST_EMAIL} failed: ${error.code ?? "no code"} ${error.message}` };
  if (cookieJar.size === 0) return { ok: false, reason: "signing in wrote no session cookie" };
  return { ok: true, value: [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

/** A source of session cookies that opens a new session before the current one expires. Reads .env.local's keys. */
export function createSessionCookieSource(): Result<() => Promise<Result<string>>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password = readToolsTestPassword();
  if (!url || !publishableKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (.env.local)" };
  if (!password.ok) return password;
  let current: { cookieHeader: string; openedAtMs: number } | null = null;
  return {
    ok: true,
    value: async () => {
      if (current && performance.now() - current.openedAtMs < RENEW_AFTER_MS) return { ok: true, value: current.cookieHeader };
      const opened = await openSession(url, publishableKey, password.value);
      if (opened.ok) current = { cookieHeader: opened.value, openedAtMs: performance.now() };
      return opened;
    },
  };
}
