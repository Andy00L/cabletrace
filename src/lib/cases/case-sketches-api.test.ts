import { describe, expect, test } from "bun:test";
import type { CaseSketch } from "./case-sketch";
import { parseCaseSketches } from "./case-sketches-api";

const sketch: CaseSketch = { landPath: "M0 0h1v1h-1z", lines: [{ kind: "power", path: "M0 0L1 1" }], trackPath: "M0 0L2 2", dragPath: null, cuts: [{ x: 1, y: 1, label: "Estlink 2" }] };

describe("parseCaseSketches", () => {
  test("keeps each case's sketch and a case without one", () => {
    const parsed = parseCaseSketches({ "eagle-s-2024": sketch, "rubymar-2024": null });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.get("eagle-s-2024")).toEqual(sketch);
    expect(parsed.value.get("rubymar-2024")).toBeNull();
  });

  test("turns a malformed sketch into no map, and refuses an answer that is not an object", () => {
    const parsed = parseCaseSketches({ "eagle-s-2024": { ...sketch, lines: [{ kind: "rope", path: "M0 0" }] } });
    expect(parsed.ok && parsed.value.get("eagle-s-2024")).toBeNull();
    expect(parseCaseSketches([sketch]).ok).toBe(false);
  });
});
