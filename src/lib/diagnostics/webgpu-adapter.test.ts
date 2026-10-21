import { describe, expect, test } from "bun:test";
import { judgeGpuAdapter, waitForIdleTicks } from "./webgpu-adapter";

describe("judgeGpuAdapter", () => {
  test("accepts a real GPU that says it is not a fallback", () => {
    expect(judgeGpuAdapter({ isFallback: false, description: "amd gcn-5" })).toEqual({ ok: true, value: "amd gcn-5" });
  });

  test("refuses the fallback adapter headless test browsers get", () => {
    expect(judgeGpuAdapter({ isFallback: true, description: "google swiftshader" }).ok).toBe(false);
  });

  test("refuses a CPU renderer that leaves the fallback flag false", () => {
    expect(judgeGpuAdapter({ isFallback: false, description: "mesa llvmpipe" }).ok).toBe(false);
  });

  test("refuses an adapter that does not say, and no adapter at all", () => {
    expect(judgeGpuAdapter({ isFallback: null, description: "nvidia ampere" }).ok).toBe(false);
    expect(judgeGpuAdapter(null).ok).toBe(false);
  });
});

describe("waitForIdleTicks", () => {
  test("counts a long block of the main thread as one tick, not as the whole budget", async () => {
    const startedAt = performance.now();
    let isDone = false;
    const ticks = waitForIdleTicks(5, 10).then(() => {
      isDone = true;
    });
    // A 200 ms block, as Windows Chrome blocks while WebGPU starts: a 50 ms wall-clock timeout would be over after it.
    while (performance.now() - startedAt < 200) {
      // blocked
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(isDone).toBe(false);
    await ticks;
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(240);
  });
});
