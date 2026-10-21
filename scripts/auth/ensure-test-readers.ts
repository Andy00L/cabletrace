// Creates the two test readers on Supabase Auth, or puts their passwords back (scripts/auth/test-readers.ts). Safe to
// run again: an existing reader keeps its id, so its watchlist stays. Needs NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY and TOOLS_TEST_PASSWORD from .env.local; prints no secret.
// Run: bun scripts/auth/ensure-test-readers.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../src/lib/result";
import { readToolsTestPassword, TESTSPRITE_TEST_EMAIL, TESTSPRITE_TEST_PASSWORD, TOOLS_TEST_EMAIL } from "./test-readers";

// The project has a handful of accounts; one page of this size holds them all.
const USERS_PER_PAGE = 1_000;

async function ensureReader(admin: SupabaseClient, email: string, password: string): Promise<Result<"created" | "reset">> {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: USERS_PER_PAGE });
  if (listed.error) return { ok: false, reason: `listing users failed: ${listed.error.message}` };
  const existing = listed.data.users.find((user) => user.email === email);
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    return updated.error ? { ok: false, reason: `resetting ${email} failed: ${updated.error.message}` } : { ok: true, value: "reset" };
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  return created.error ? { ok: false, reason: `creating ${email} failed: ${created.error.code ?? "no code"} ${created.error.message}` } : { ok: true, value: "created" };
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const toolsPassword = readToolsTestPassword();
  if (!url || !secretKey) {
    console.error("[ensureTestReaders] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local)");
    return 1;
  }
  if (!toolsPassword.ok) {
    console.error(`[ensureTestReaders] ${toolsPassword.reason}`);
    return 1;
  }
  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let exitCode = 0;
  for (const [email, password] of [
    [TOOLS_TEST_EMAIL, toolsPassword.value],
    [TESTSPRITE_TEST_EMAIL, TESTSPRITE_TEST_PASSWORD],
  ] as const) {
    const ensured = await ensureReader(admin, email, password);
    if (ensured.ok) {
      console.log(`[ensureTestReaders] ${email}: ${ensured.value}`);
    } else {
      console.error(`[ensureTestReaders] ${ensured.reason}`);
      exitCode = 1;
    }
  }
  return exitCode;
}

process.exit(await main());
