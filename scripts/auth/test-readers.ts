// The two test readers, each with its own watchlist. The tools' reader (lookdev, perf, checks) signs in with a
// password kept in .env.local (TOOLS_TEST_PASSWORD), which Bun loads. The TestSprite reader's password is public on
// purpose: the plans in testsprite/plans type it into the form, and the suite runs from TestSprite's cloud. Anyone
// can create an account anyway, so it opens nothing a stranger could not open; scripts/auth/ensure-test-readers.ts
// resets both passwords if someone changes one.
// example.com is reserved for examples (RFC 2606) and receives no mail; Supabase Auth sends none to it either.
import type { Result } from "../../src/lib/result";

export const TOOLS_TEST_EMAIL = "cabletrace-tools@example.com";
export const TESTSPRITE_TEST_EMAIL = "testsprite@example.com";
export const TESTSPRITE_TEST_PASSWORD = "cabletrace-testsprite-2026";

/** The tools' reader's password, from the environment; never printed. */
export function readToolsTestPassword(): Result<string> {
  const password = process.env.TOOLS_TEST_PASSWORD;
  return password ? { ok: true, value: password } : { ok: false, reason: "TOOLS_TEST_PASSWORD is not set (it lives in .env.local)" };
}
