// Signs a Playwright page in as the tools' test reader through the real form (src/components/account/AccountForm.tsx),
// so scripts that open pages behind sign-in (lookdev, perf, checks) keep working with the gate on (src/proxy.ts).
// The reader exists on Supabase Auth (scripts/auth/ensure-test-readers.ts); its password comes from .env.local.
import type { Page } from "playwright";
import type { Result } from "../../src/lib/result";
import { readToolsTestPassword, TOOLS_TEST_EMAIL } from "./test-readers";

// How long one step (the page, the form, the redirect after it) may take before the attempt counts as failed.
const SIGN_IN_TIMEOUT_MS = 30_000;
// A whole attempt is retried once on a fresh sign-in page before the caller hears of a failure.
const SIGN_IN_ATTEMPTS = 2;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One pass through the form; throws on a timeout, which the caller turns into a retry or a result. */
async function attemptSignIn(page: Page, baseUrl: string, password: string): Promise<void> {
  const appOrigin = new URL(baseUrl).origin;
  const isAppPageAfterSignIn = (url: URL) => url.origin === appOrigin && url.pathname !== "/sign-in";
  await page.goto(`${appOrigin}/sign-in`, { waitUntil: "domcontentloaded" });
  // A retry after a first attempt that signed in late finds a session: the proxy sends the page on instead.
  if (isAppPageAfterSignIn(new URL(page.url()))) return;
  const form = page.getByTestId("account-form");
  await form.locator('input[name="email"]').fill(TOOLS_TEST_EMAIL, { timeout: SIGN_IN_TIMEOUT_MS });
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(isAppPageAfterSignIn, { timeout: SIGN_IN_TIMEOUT_MS });
}

/** Signs the page in through the real form; afterwards the page sits on the console, where the form sends a reader. */
export async function signInTestUser(page: Page, baseUrl: string): Promise<Result<null>> {
  const password = readToolsTestPassword();
  if (!password.ok) return password;
  let lastReason = "";
  for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
    try {
      await attemptSignIn(page, baseUrl, password.value);
      return { ok: true, value: null };
    } catch (error) {
      lastReason = describeError(error);
      console.error(`[signInTestUser] attempt ${attempt} of ${SIGN_IN_ATTEMPTS} did not complete: ${lastReason.split("\n")[0]}`);
    }
  }
  return { ok: false, reason: `[signInTestUser] sign-in did not complete after ${SIGN_IN_ATTEMPTS} attempts: ${lastReason}` };
}
