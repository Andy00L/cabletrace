import { describe, expect, test } from "bun:test";
import { buildAsciiGrid, parseHexColour, shiftGlyph } from "@/lib/ascii/ascii-grid";

// A row of four cells from black to white, RGBA.
const GREY_STEPS = [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255];
const PARCHMENT = parseHexColour("#F2EADA") ?? [0, 0, 0];

describe("buildAsciiGrid", () => {
  test("stretches brightness to the ramp: the darkest cell is bare, the brightest the densest glyph", () => {
    const cells = buildAsciiGrid({ pixels: GREY_STEPS, columns: 4, rows: 1, ramp: "dense", isInverted: false, tone: null, toneShare: 0, fadeShare: 0, ground: PARCHMENT });
    expect(cells[0]).toBeNull();
    expect(cells[3]?.glyph).toBe("@");
    expect(cells[3]?.rgb).toEqual([255, 255, 255]);
  });

  test("inverts for a light ground, so dark patches carry the glyphs", () => {
    const cells = buildAsciiGrid({ pixels: GREY_STEPS, columns: 4, rows: 1, ramp: "dense", isInverted: true, tone: null, toneShare: 0, fadeShare: 0, ground: PARCHMENT });
    expect(cells[0]?.glyph).toBe("@");
    expect(cells[3]).toBeNull();
  });

  test("moves colours toward the tone by its share", () => {
    const cells = buildAsciiGrid({ pixels: GREY_STEPS, columns: 4, rows: 1, ramp: "dense", isInverted: false, tone: [0, 0, 0], toneShare: 0.5, fadeShare: 0, ground: PARCHMENT });
    expect(cells[3]?.rgb).toEqual([127.5, 127.5, 127.5]);
  });

  test("a fade leaves the last row emptier than the first", () => {
    const columns = 8;
    const rows = 8;
    const pixels = Array.from({ length: columns * rows * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index % (columns * 4)) * 4));
    const cells = buildAsciiGrid({ pixels, columns, rows, ramp: "dense", isInverted: false, tone: null, toneShare: 0, fadeShare: 0.5, ground: PARCHMENT });
    const countDrawn = (row: number) => cells.slice(row * columns, (row + 1) * columns).filter((cell) => cell !== null).length;
    expect(countDrawn(rows - 1)).toBeLessThan(countDrawn(0));
  });
});

describe("parseHexColour and shiftGlyph", () => {
  test("reads #RRGGBB and refuses anything else", () => {
    expect(parseHexColour("#2B2E2A")).toEqual([43, 46, 42]);
    expect(parseHexColour("slate")).toBeNull();
  });

  test("steps along the ramp without reaching the space", () => {
    expect(shiftGlyph("#", "dense", 1)).toBe("%");
    expect(shiftGlyph(".", "dense", -1)).toBe(".");
  });
});
