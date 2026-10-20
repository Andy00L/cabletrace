// A Clerk session token for the tools' test reader, made through Clerk's Backend API, for a browser the tools cannot
// sign in through the form: the lookdev harness's WebGPU tier drives Windows Chrome from the command line
// (scripts/lookdev/webgpu-capture.ts), and its proxy sends the token upstream as `Authorization: Bearer`, which
// Clerk's middleware accepts in place of the session cookie. Development instance only: creating a session through
// the Backend API is a testing endpoint. The secret key is read from the environment and never printed.
// sourceRef: https://clerk.com/docs/reference/backend-api (POST /v1/sessions, POST /v1/sessions/{session_id}/tokens)
import type { Result } from "../../src/lib/result";
import { TOOLS_TEST_EMAIL } from "../auth/sign-in-test-user";

const CLERK_API = "https://api.clerk.com/v1";
// The token lives this long (s); a new one is made once this share of its life has passed.
const TOKEN_LIFETIME_SECONDS = 600;
const RENEW_AFTER_SHARE = 0.5;

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const found: unknown = Reflect.get(value, field);
  return typeof found === "string" ? found : null;
}

async function callClerk(secretKey: string, method: "GET" | "POST", route: string, body: object | null): Promise<Result<unknown>> {
  try {
    const response = await fetch(`${CLERK_API}${route}`, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, reason: `Clerk answered ${response.status} on ${method} ${route}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, reason: `Clerk could not be reached on ${route}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Makes a fresh session token for the test reader: finds the user, opens a session, mints a token on it. */
async function mintSessionToken(secretKey: string): Promise<Result<string>> {
  const users = await callClerk(secretKey, "GET", `/users?email_address=${encodeURIComponent(TOOLS_TEST_EMAIL)}`, null);
  if (!users.ok) return users;
  const userId = Array.isArray(users.value) ? readStringField(users.value[0], "id") : null;
  if (!userId) return { ok: false, reason: `no Clerk user ${TOOLS_TEST_EMAIL}` };
  const session = await callClerk(secretKey, "POST", "/sessions", { user_id: userId });
  if (!session.ok) return session;
  const sessionId = readStringField(session.value, "id");
  if (!sessionId) return { ok: false, reason: "Clerk opened no session" };
  const token = await callClerk(secretKey, "POST", `/sessions/${sessionId}/tokens`, { expires_in_seconds: TOKEN_LIFETIME_SECONDS });
  if (!token.ok) return token;
  const jwt = readStringField(token.value, "jwt");
  return jwt ? { ok: true, value: jwt } : { ok: false, reason: "Clerk minted no token" };
}

/** A source of session tokens that renews its token before it expires. Needs CLERK_SECRET_KEY in the environment. */
export function createSessionTokenSource(): Result<() => Promise<Result<string>>> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return { ok: false, reason: "CLERK_SECRET_KEY is not set (it lives in .env.local)" };
  let current: { token: string; mintedAtMs: number } | null = null;
  return {
    ok: true,
    value: async () => {
      const ageMs = current ? performance.now() - current.mintedAtMs : Number.POSITIVE_INFINITY;
      if (current && ageMs < TOKEN_LIFETIME_SECONDS * 1000 * RENEW_AFTER_SHARE) return { ok: true, value: current.token };
      const minted = await mintSessionToken(secretKey);
      if (minted.ok) current = { token: minted.value, mintedAtMs: performance.now() };
      return minted;
    },
  };
}
