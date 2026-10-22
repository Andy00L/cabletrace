import { describe, expect, test } from "bun:test";
import { buildAsciiGrid, canShimmer, parseHexColour, readSamplesPerCell, shiftGlyph, type AsciiGridOptions } from "@/lib/ascii/ascii-grid";

// A row of four cells from black to white, RGBA.
const GREY_STEPS = [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255];
const PARCHMENT = parseHexColour("#F2EADA") ?? [0, 0, 0];
const BASE_OPTIONS: AsciiGridOptions = { pixels: GREY_STEPS, columns: 4, rows: 1, style: "glyph", ramp: "dense", isInverted: false, tone: null, toneShare: 0, fadeShare: 0, ground: PARCHMENT };

describe("buildAsciiGrid", () => {
  test("stretches brightness to the ramp: the darkest cell is bare, the brightest the densest glyph", () => {
    const cells = buildAsciiGrid(BASE_OPTIONS);
    expect(cells[0]).toBeNull();
    expect(cells[3]?.glyph).toBe("@");
    expect(cells[3]?.ink).toBe(1);
    expect(cells[3]?.rgb).toEqual([255, 255, 255]);
  });

  test("inverts for a light ground, so dark patches carry the ink", () => {
    const cells = buildAsciiGrid({ ...BASE_OPTIONS, isInverted: true });
    expect(cells[0]?.glyph).toBe("@");
    expect(cells[3]).toBeNull();
  });

  test("moves colours toward the tone by its share", () => {
    const cells = buildAsciiGrid({ ...BASE_OPTIONS, tone: [0, 0, 0], toneShare: 0.5 });
    expect(cells[3]?.rgb).toEqual([127.5, 127.5, 127.5]);
  });

  test("a fade leaves the last row emptier than the first", () => {
    const columns = 8;
    const rows = 8;
    const pixels = Array.from({ length: columns * rows * 4 }, (_, index) => (index % 4 === 3 ? 255 : (index % (columns * 4)) * 4));
    const cells = buildAsciiGrid({ ...BASE_OPTIONS, pixels, columns, rows, fadeShare: 0.5 });
    const countDrawn = (row: number) => cells.slice(row * columns, (row + 1) * columns).filter((cell) => cell !== null).length;
    expect(countDrawn(rows - 1)).toBeLessThan(countDrawn(0));
  });

  test("binary writes 1 for dense ink and 0 for light ink", () => {
    const cells = buildAsciiGrid({ ...BASE_OPTIONS, style: "binary" });
    expect(cells.map((cell) => cell?.glyph ?? null)).toEqual([null, "0", "1", "1"]);
  });

  test("braille reads 2 by 4 samples per cell and sets a dot where the ink passes its dither step", () => {
    expect(readSamplesPerCell("braille")).toEqual({ across: 2, down: 4 });
    // One cell, its left column black and its right column white: only the right column's four dots can be set.
    const pixels = Array.from({ length: 8 }, (_, sampleIndex) => (sampleIndex % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])).flat();
    const [cell] = buildAsciiGrid({ ...BASE_OPTIONS, pixels, columns: 1, rows: 1, style: "braille" });
    const bits = (cell?.glyph.charCodeAt(0) ?? 0x2800) - 0x2800;
    expect(bits).toBe(0x08 | 0x10 | 0x20 | 0x80);
  });

  test("dither fills a cell only where its ink passes the cell's step, and draws shapes, not glyphs", () => {
    const cells = buildAsciiGrid({ ...BASE_OPTIONS, style: "dither" });
    expect(cells[0]).toBeNull();
    expect(cells[3]?.glyph).toBe("");
  });
});

describe("parseHexColour, shiftGlyph and canShimmer", () => {
  test("reads #RRGGBB and refuses anything else", () => {
    expect(parseHexColour("#2B2E2A")).toEqual([43, 46, 42]);
    expect(parseHexColour("slate")).toBeNull();
  });

  test("steps a glyph along the ramp without reaching the space, and flips a binary digit", () => {
    expect(shiftGlyph("#", "glyph", "dense", 1)).toBe("%");
    expect(shiftGlyph(".", "glyph", "dense", -1)).toBe(".");
    expect(shiftGlyph("1", "binary", "dense", 1)).toBe("0");
  });

  test("only the character styles shimmer", () => {
    expect(canShimmer("braille")).toBe(true);
    expect(canShimmer("halftone")).toBe(false);
  });
});
