// Signs a Playwright page in as the tools' test reader, so scripts that open pages behind sign-in (lookdev, perf,
// checks) keep working with the gate on (src/proxy.ts). Clerk's development instance treats any +clerk_test address
// as a test address with the fixed code 424242 and sends no email.
// sourceRef: https://clerk.com/docs/guides/development/testing/test-emails-and-phones.md
// The user exists on the development instance (created 2026-10-20 through Clerk's Backend API). On a production
// instance test addresses are off, and these tools need another route in (docs/PERFORMANCE.md, Signing in).
import type { Page } from "playwright";
import type { Result } from "../../src/lib/result";

export const TOOLS_TEST_EMAIL = "cabletrace-tools+clerk_test@example.com";
const TEST_CODE = "424242";
// Under load (a shared machine at a load of 7 to 9) Clerk's form took longer than 30 s about once in three runs.
const SIGN_IN_TIMEOUT_MS = 45_000;
// A whole attempt is retried once on a fresh sign-in page before the caller hears of a failure.
const SIGN_IN_ATTEMPTS = 2;
// Clerk sometimes takes the code before its "send code" request has landed and answers with this message; Resend and
// typing the code again recovers (seen about once in 50 sign-ins by the TestSprite suite's judge).
const CODE_NOT_SENT_TEXT = "You need to send a verification code";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One pass through the real form; throws on a timeout, which the caller turns into a retry or a result. */
async function attemptSignIn(page: Page, baseUrl: string): Promise<void> {
  const appOrigin = new URL(baseUrl).origin;
  // Clerk's development instance passes through its own handshake address on the way; only a page of the app counts.
  const isAppPageAfterSignIn = (url: URL) => url.origin === appOrigin && !url.pathname.startsWith("/sign-in");
  await page.goto(`${appOrigin}/sign-in`, { waitUntil: "domcontentloaded" });
  const emailField = page.locator('input[name="identifier"]');
  // A retry after a first attempt that signed in late finds a session: Clerk sends the page on instead of the form.
  const isFormShown = emailField.waitFor({ timeout: SIGN_IN_TIMEOUT_MS }).then(() => "form" as const);
  const isSignedIn = page.waitForURL(isAppPageAfterSignIn, { timeout: SIGN_IN_TIMEOUT_MS }).then(() => "signed-in" as const);
  const landing = await Promise.race([isFormShown, isSignedIn]);
  isFormShown.catch(() => undefined);
  isSignedIn.catch(() => undefined);
  if (landing === "signed-in") return;
  await emailField.fill(TOOLS_TEST_EMAIL);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Clerk's code field is a row of single-digit inputs that takes typed digits; it submits after the sixth.
  const codeField = page.locator('input[autocomplete="one-time-code"]').first();
  await codeField.waitFor({ timeout: SIGN_IN_TIMEOUT_MS });
  await codeField.click();
  await page.keyboard.type(TEST_CODE);
  const hasLeftSignIn = page.waitForURL(isAppPageAfterSignIn, { timeout: SIGN_IN_TIMEOUT_MS }).then(() => "left" as const);
  const isCodeNotSent = page.getByText(CODE_NOT_SENT_TEXT).waitFor({ timeout: SIGN_IN_TIMEOUT_MS }).then(() => "code-not-sent" as const);
  const outcome = await Promise.race([hasLeftSignIn, isCodeNotSent]);
  // The losing wait keeps running until its own timeout; its rejection is expected and carries nothing.
  hasLeftSignIn.catch(() => undefined);
  isCodeNotSent.catch(() => undefined);
  if (outcome === "left") return;
  await page.getByRole("button", { name: /Resend/u }).click({ timeout: SIGN_IN_TIMEOUT_MS });
  await codeField.click();
  await page.keyboard.type(TEST_CODE);
  await page.waitForURL(isAppPageAfterSignIn, { timeout: SIGN_IN_TIMEOUT_MS });
}

/** Signs the page in through the real form; afterwards the page sits on whatever Clerk redirected to. */
export async function signInTestUser(page: Page, baseUrl: string): Promise<Result<null>> {
  let lastReason = "";
  for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
    try {
      await attemptSignIn(page, baseUrl);
      return { ok: true, value: null };
    } catch (error) {
      lastReason = describeError(error);
      console.error(`[signInTestUser] attempt ${attempt} of ${SIGN_IN_ATTEMPTS} did not complete: ${lastReason.split("\n")[0]}`);
    }
  }
  return { ok: false, reason: `[signInTestUser] sign-in did not complete after ${SIGN_IN_ATTEMPTS} attempts: ${lastReason}` };
}
