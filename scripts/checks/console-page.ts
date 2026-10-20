// Shared by the console checks in this folder: argument parsing, the headless browser, and opening a case's
// replay console in its first state. The checks drive the console through data-testid attributes, roles and
// accessible names only, never layout positions, so they survive layout changes.
import { chromium, type Browser, type Page } from "playwright";
import { CABLE_CASES } from "../../src/data/cases";
import type { CableCase } from "../../src/lib/cases/case-file";
import type { Result } from "../../src/lib/result";
import { signInTestUser } from "../auth/sign-in-test-user";
import { resolveChromiumPath } from "../perf/chromium-path";

// The same software renderer as scripts/perf, so the 3D view draws on a machine without a GPU.
const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const NAVIGATION_TIMEOUT_MS = 60_000;
// Time for the console's client effects (media queries, URL state) to run after it first renders.
const CONSOLE_SETTLE_MS = 600;
// Layers enter in 220 ms (docs/UI_DESIGN_SYSTEM.md, Motion); this leaves room for the exit and a frame.
export const LAYER_SETTLE_MS = 400;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export type Viewport = { width: number; height: number };

export type CheckArguments = {
  baseUrl: string;
  chromiumPath: string;
  viewport: Viewport;
  cases: readonly CableCase[];
};

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? error.name : String(error);
}

function readFlagValue(argumentList: readonly string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/**
 * Reads `<baseUrl> [--case <slug>] [--viewport <width>x<height>] [--chromium <path>]`. Without `--case` every case
 * is checked.
 */
export function parseCheckArguments(argumentList: readonly string[]): Result<CheckArguments> {
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) return { ok: false, reason: "pass the base URL, for example https://cabletrace.vercel.app or http://localhost:3102" };
  const chromiumPath = resolveChromiumPath(readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) return chromiumPath;
  const viewportText = readFlagValue(argumentList, "--viewport");
  const viewportMatch = viewportText === null ? null : /^(\d{3,4})x(\d{3,4})$/.exec(viewportText);
  if (viewportText !== null && !viewportMatch) return { ok: false, reason: `--viewport takes <width>x<height>, got ${viewportText}` };
  const viewport = viewportMatch ? { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) } : DEFAULT_VIEWPORT;
  const caseSlug = readFlagValue(argumentList, "--case");
  const cases = caseSlug === null ? CABLE_CASES : CABLE_CASES.filter((cableCase) => cableCase.slug === caseSlug);
  if (cases.length === 0) return { ok: false, reason: `no case with slug ${caseSlug}` };
  return { ok: true, value: { baseUrl, chromiumPath: chromiumPath.value, viewport, cases } };
}

export async function launchBrowser(chromiumPath: string): Promise<Result<Browser>> {
  try {
    return { ok: true, value: await chromium.launch({ executablePath: chromiumPath, args: CHROMIUM_ARGS }) };
  } catch (error) {
    return { ok: false, reason: `Chromium did not start: ${describeError(error)}` };
  }
}

/**
 * Loads a console URL (`/cases/<slug>` plus any query), signing in first when the gate asks, and waits until the
 * console is on screen. CSS animations and
 * transitions are switched off: under the software renderer a busy machine can stall an exit animation for
 * seconds, and Radix keeps a closing layer in the page until its animation ends. These checks are about what is
 * reachable and where focus goes, not motion, and the console shows its content without waiting for an animation
 * (docs/UI_DESIGN_SYSTEM.md, Console, Layers).
 */
export async function openConsole(page: Page, url: string): Promise<Result<null>> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    // The console sits behind sign-in (src/proxy.ts): a fresh context lands on the form first, signs in once, and
    // keeps the session for the rest of its pages.
    if (new URL(page.url()).pathname.startsWith("/sign-in")) {
      const signedIn = await signInTestUser(page, new URL(url).origin);
      if (!signedIn.ok) return signedIn;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    }
    await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
    await page.getByTestId("replay-console").waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS });
    // The 3D view adds its place and line labels once the seabed has loaded (src/components/replay/SeabedView.tsx:
    // data-state "ready", or "failed" without WebGL), so the first state is read after that.
    await page.locator('[data-testid="seabed-view"]:not([data-state="loading"])').first().waitFor({ state: "attached", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(CONSOLE_SETTLE_MS);
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, reason: `${url} did not open the console: ${describeError(error)}` };
  }
}

/** Every data-testid a console layer carries (src/components/console/ConsoleLayers.tsx), by layer kind. */
export const LAYER_TEST_IDS = {
  cut: "cut-card",
  placement: "placement-popover",
  source: "source-popover",
  sources: "source-list",
  aftermath: "aftermath-card",
  shortcuts: "shortcuts-dialog",
  vessel: "vessel-card",
} as const;

export type LayerKind = keyof typeof LAYER_TEST_IDS;
