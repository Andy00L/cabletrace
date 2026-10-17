import { describe, expect, test } from "bun:test";
import { combineGlobeLines, describeGlobeLine, describeGlobeLineKind, parseWorldLines } from "./world-lines";

const FILE = {
  osmBase: "2026-10-17T15:52:51Z",
  unitsPerDegree: 1000,
  lines: [
    { name: "C-Lion 1", kind: "telecom", substance: null, operator: "Cinia", parts: [[24000, 60000, 500, -250, 500, -250]] },
    { name: null, kind: "pipeline", substance: "gas", operator: null, parts: [[-179900, 10000, -200, 0]] },
  ],
};

describe("parseWorldLines", () => {
  test("decodes the delta-encoded thousandths of a degree", () => {
    const parsed = parseWorldLines(FILE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.osmBase).toBe("2026-10-17T15:52:51Z");
    expect(parsed.value.lines[0]?.parts[0]).toEqual([24, 60, 24.5, 59.75, 25, 59.5]);
    expect(parsed.value.lines[1]).toMatchObject({ name: null, kind: "pipeline", substance: "gas", parts: [[-179.9, 10, -180.1, 10]] });
  });

  test("rejects a file with an unknown kind, an odd part or a fractional step", () => {
    expect(parseWorldLines({ ...FILE, lines: [{ ...FILE.lines[0], kind: "railway" }] }).ok).toBe(false);
    expect(parseWorldLines({ ...FILE, lines: [{ ...FILE.lines[0], parts: [[1, 2, 3]] }] }).ok).toBe(false);
    expect(parseWorldLines({ ...FILE, lines: [{ ...FILE.lines[0], parts: [[1, 2, 3.5, 4]] }] }).ok).toBe(false);
    expect(parseWorldLines({ lines: [] }).ok).toBe(false);
  });
});

describe("combineGlobeLines", () => {
  test("numbers the world's lines first and marks the watched ones", () => {
    const parsed = parseWorldLines(FILE);
    if (!parsed.ok) throw new Error(parsed.reason);
    const combined = combineGlobeLines(parsed.value.lines, [{ name: "Estlink 2", kind: "power", points: [25, 60, 26, 59.5] }]);
    expect(combined.map((line) => [line.id, line.isWatched])).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ]);
    expect(combined[2]?.parts).toEqual([[25, 60, 26, 59.5]]);
  });
});

describe("describeGlobeLine", () => {
  test("names a line, or says what it is when it has no name", () => {
    expect(describeGlobeLine({ name: "C-Lion 1", kind: "telecom", substance: null })).toBe("C-Lion 1");
    expect(describeGlobeLine({ name: null, kind: "pipeline", substance: "gas" })).toBe("Unnamed gas pipeline");
    expect(describeGlobeLine({ name: null, kind: "power", substance: null })).toBe("Unnamed power cable");
    expect(describeGlobeLineKind({ kind: "pipeline", substance: "oil" })).toBe("Oil pipeline");
  });
});
