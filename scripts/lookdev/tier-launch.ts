import { existsSync } from "node:fs";

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
