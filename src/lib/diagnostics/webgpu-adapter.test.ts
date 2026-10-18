import { describe, expect, test } from "bun:test";
import { judgeGpuAdapter } from "./webgpu-adapter";

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
