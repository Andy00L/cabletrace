/// <reference types="@webgpu/types" />
import { classifyRenderer } from "@/lib/diagnostics/webgl-renderer";
import type { Result } from "@/lib/result";

// The WebGPU tier of the 3D replay runs only on a real GPU adapter. Browsers without a usable GPU hand out a CPU
// fallback (SwiftShader in headless Chromium, which TestSprite drives) that reports itself as a fallback adapter; those
// keep the WebGL tiers. The adapter is checked here, before any WebGPU code loads, and the device made from it is the
// one the renderer draws with, so the tier the canvas reports is the adapter that was checked.

// requestAdapter has hung on this machine under some flags (docs/LOOKDEV.md, WebGPU); past this budget the page keeps
// the WebGL tiers instead of waiting. The budget is counted in ticks of an idle page, 30 of 100 ms (3 s), not in wall
// time: on Windows Chrome the main thread stays blocked 2.8 to 3.3 s in one go while the GPU process starts WebGPU, and
// a wall-clock timer then fired in the same moment the adapter arrived and won, so the page drew on WebGL.
const ADAPTER_TICK_MS = 100;
const ADAPTER_TICK_COUNT = 30;

/** What the browser says about an adapter: whether it is a fallback (null when it does not say) and its name. */
export type GpuAdapterFacts = { isFallback: boolean | null; description: string };

export type WebGpuDevice = { device: GPUDevice; adapterName: string };

/**
 * Whether an adapter may carry the WebGPU tier: it must say it is not a fallback, and its name must not be a CPU
 * renderer's (the WebGL tiers' own test, for browsers that leave the flag out).
 */
export function judgeGpuAdapter(facts: GpuAdapterFacts | null): Result<string> {
  if (facts === null) return { ok: false, reason: "no WebGPU adapter" };
  if (facts.isFallback === null) return { ok: false, reason: "the adapter does not say whether it is a fallback" };
  if (facts.isFallback) return { ok: false, reason: `fallback adapter (${facts.description})` };
  if (classifyRenderer(facts.description) === "software") return { ok: false, reason: `CPU adapter (${facts.description})` };
  return { ok: true, value: facts.description };
}

/** Reads the fallback flag from the adapter's info (the current spec) or the adapter itself (Chrome before 125). */
function readAdapterFacts(adapter: GPUAdapter): GpuAdapterFacts {
  const info: unknown = Reflect.get(adapter, "info");
  const infoFlag: unknown = typeof info === "object" && info !== null ? Reflect.get(info, "isFallbackAdapter") : undefined;
  const adapterFlag: unknown = Reflect.get(adapter, "isFallbackAdapter");
  const flags = [infoFlag, adapterFlag].filter((flag): flag is boolean => typeof flag === "boolean");
  const nameParts = typeof info === "object" && info !== null ? ["vendor", "architecture", "description"].map((key) => Reflect.get(info, key)) : [];
  const description = nameParts.filter((part): part is string => typeof part === "string" && part !== "").join(" ") || "unknown adapter";
  return { isFallback: flags.length === 0 ? null : flags.some((flag) => flag), description };
}

/** A name in the adapter's feature set is, by definition, a feature name this browser accepts in requestDevice. */
function isOfferedFeature(adapter: GPUAdapter, name: string): name is GPUFeatureName {
  return adapter.features.has(name);
}

function waitForTask(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Resolves after `tickCount` timer ticks of `tickMs`, each started once the previous one has run: a main thread
 * blocked for seconds delays one tick, so the budget measures time the page was free to hear back.
 */
export async function waitForIdleTicks(tickCount: number, tickMs: number): Promise<void> {
  for (let tick = 0; tick < tickCount; tick += 1) await waitForTask(tickMs);
}

/** The adapter, or null when the browser gives none or the idle budget runs out first (with one task's grace). */
async function requestAdapterWithinBudget(gpu: GPU): Promise<GPUAdapter | null> {
  let answer: { adapter: GPUAdapter | null } | null = null;
  const request = gpu.requestAdapter({ powerPreference: "high-performance" }).then((adapter) => {
    answer = { adapter };
    return adapter;
  });
  const budget = waitForIdleTicks(ADAPTER_TICK_COUNT, ADAPTER_TICK_MS).then(async () => {
    // The adapter's answer may be queued behind the last tick: one more task lets it in.
    await waitForTask(0);
    return answer?.adapter ?? null;
  });
  return Promise.race([request, budget]);
}

/**
 * Asks the browser for a GPU adapter and, when it is a real one, a device on it with every feature it offers (as
 * three.js asks for its own). Never throws: no WebGPU, a fallback adapter, a timeout or a refused device is a reason.
 */
export async function requestWebGpuDevice(): Promise<Result<WebGpuDevice>> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return { ok: false, reason: "this browser has no WebGPU" };
  try {
    const adapter = await requestAdapterWithinBudget(navigator.gpu);
    const verdict = judgeGpuAdapter(adapter ? readAdapterFacts(adapter) : null);
    if (!adapter || !verdict.ok) return { ok: false, reason: verdict.ok ? "no WebGPU adapter" : verdict.reason };
    const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features].filter((feature) => isOfferedFeature(adapter, feature)) });
    return { ok: true, value: { device, adapterName: verdict.value } };
  } catch (error) {
    return { ok: false, reason: `WebGPU device refused: ${error instanceof Error ? error.message : String(error)}` };
  }
}
