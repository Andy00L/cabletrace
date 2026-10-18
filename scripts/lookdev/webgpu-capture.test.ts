import { describe, expect, test } from "bun:test";
import { cropToBox, parseAgentReport } from "./webgpu-capture";

// Chrome writes console messages to stderr with the message's own quotes left as they are.
const chromeLine = (message: string) => `[1:2:1017/200725.181:INFO:CONSOLE:7] "${message}", source: http://localhost:3329/cases/eagle-s-2024 (7)`;

describe("parseAgentReport", () => {
  test("reads the agent's report out of Chrome's log", () => {
    const report = { error: null, renderer: "webgpu", adapterName: "amd gcn-5", devicePixelRatio: 1, readyMs: 4200, viewRect: { left: 16, top: 56, width: 1408, height: 602 }, canvasRect: null, colorProbes: [{ tone: "cable", x: 1, y: 2 }], seabedProbes: [], scrubFrameMs: 16, viewportWidth: 1440, viewportHeight: 900 };
    const parsed = parseAgentReport(`noise\n${chromeLine(`LOOKDEV_RESULT ${JSON.stringify(report)}`)}\nmore noise`);
    expect(parsed.ok && parsed.value.renderer).toBe("webgpu");
    expect(parsed.ok && parsed.value.viewRect).toEqual({ left: 16, top: 56, width: 1408, height: 602 });
    expect(parsed.ok && parsed.value.scrubFrameMs).toBe(16);
  });

  test("turns the agent's own failure and a missing line into reasons", () => {
    expect(parseAgentReport(chromeLine('LOOKDEV_RESULT {"error":"timed out waiting for the 3D view"}'))).toEqual({ ok: false, reason: "the page agent gave up: timed out waiting for the 3D view" });
    expect(parseAgentReport("Page load failed").ok).toBe(false);
  });
});

describe("cropToBox", () => {
  test("keeps the pixels inside a box, rounded as Playwright crops", () => {
    const image = { width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_value, index) => index) };
    const cropped = cropToBox(image, { left: 0.6, top: 1, width: 2, height: 1 });
    expect(cropped.width).toBe(2);
    expect([...cropped.data]).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);
  });
});
