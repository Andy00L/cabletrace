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
const SIGN_IN_TIMEOUT_MS = 30_000;

/** Signs the page in through the real form; afterwards the page sits on whatever Clerk redirected to. */
export async function signInTestUser(page: Page, baseUrl: string): Promise<Result<null>> {
  try {
    await page.goto(`${baseUrl.replace(/\/+$/u, "")}/sign-in`, { waitUntil: "domcontentloaded" });
    const emailField = page.locator('input[name="identifier"]');
    await emailField.waitFor({ timeout: SIGN_IN_TIMEOUT_MS });
    await emailField.fill(TOOLS_TEST_EMAIL);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // Clerk's code field is a row of single-digit inputs that takes typed digits; it submits after the sixth.
    const codeField = page.locator('input[autocomplete="one-time-code"]').first();
    await codeField.waitFor({ timeout: SIGN_IN_TIMEOUT_MS });
    await codeField.click();
    await page.keyboard.type(TEST_CODE);
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: SIGN_IN_TIMEOUT_MS });
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, reason: `[signInTestUser] sign-in did not complete: ${error instanceof Error ? error.message : String(error)}` };
  }
}
