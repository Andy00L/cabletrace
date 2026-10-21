import { existsSync } from "node:fs";
import type { Browser, BrowserContext } from "playwright";
import type { Result } from "../../src/lib/result";
import { signInTestUser } from "../auth/sign-in-test-user";

// Chromium flags per Playwright tier, shared by the harness (run-lookdev.ts) and the hero shot (hero.ts). Software:
// SwiftShader, as the test browsers draw (M139 and later need the unsafe flag). Hardware: ANGLE on OpenGL; on WSL2
// Mesa's d3d12 driver reaches the Windows GPU through /dev/dxg. On a laptop with two adapters the integrated one lost
// its contexts and failed to link three.js shaders, so the driver is pointed at the adapter named in
// LOOKDEV_GPU_ADAPTER (default NVIDIA; Mesa matches part of the name).

export type PlaywrightTierName = "software" | "hardware";

export const TIER_LAUNCH: Record<PlaywrightTierName, { args: string[]; env: Record<string, string> }> = {
  software: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], env: {} },
  hardware: {
    args: ["--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu", "--enable-features=Vulkan"],
    env: existsSync("/usr/lib/wsl/lib")
      ? { GALLIUM_DRIVER: "d3d12", MESA_D3D12_DEFAULT_ADAPTER_NAME: process.env.LOOKDEV_GPU_ADAPTER ?? "NVIDIA", LD_LIBRARY_PATH: "/usr/lib/wsl/lib" }
      : {},
  },
};

/** A signed-in browser session (cookies and storage), handed to every new context that opens a page behind sign-in. */
export type SignedInState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * Signs the tools' test reader in once on `browser` (scripts/auth/sign-in-test-user.ts, about 5 s) and returns the
 * session, so each shot's fresh context starts signed in: every page but the landing sits behind sign-in
 * (src/proxy.ts). The proxy refreshes the hour-long access token from the stored refresh token when it runs out.
 */
export async function signInOnce(browser: Browser, baseUrl: string): Promise<Result<SignedInState>> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const signedIn = await signInTestUser(page, baseUrl);
    if (!signedIn.ok) return signedIn;
    return { ok: true, value: await context.storageState() };
  } finally {
    await context.close();
  }
}
