// The ASCII layer's arithmetic (docs/UI_DESIGN_SYSTEM.md, ASCII layer): a picture sampled per cell becomes a grid of
// marks, each in the colour of the patch it replaces. Brightness sets how much ink a cell carries, stretched to the
// patch's own range so a dim painting still shows its shapes; the style decides what that ink looks like (after the
// styles of ascii-magic.com). Pure, so it is tested without a browser; the canvas side is
// src/components/ascii/AsciiPicture.tsx.

/** Glyphs from empty to full. `dense` reads shapes best at small cells; `fine` gives more steps for big cells. */
export const GLYPH_RAMPS = {
  dense: " .:-=+*#%@",
  fine: " .'`^,:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@",
} as const;
export type GlyphRampName = keyof typeof GLYPH_RAMPS;

/**
 * What a cell's ink looks like.
 *   glyph     a character from the ramp, denser for more ink (classic ASCII art)
 *   binary    0 or 1, the denser ink a 1 (the record as data)
 *   braille   a braille character whose 8 dots dither the cell at 2 by 4 (fine detail in small cells)
 *   halftone  a round dot whose area follows the ink (a print screen)
 *   dither    the cell filled or left bare on an ordered dither (1-bit pixels)
 *   hatch     a horizontal stroke whose thickness follows the ink (an engraver's line)
 */
export type AsciiStyle = "glyph" | "binary" | "braille" | "halftone" | "dither" | "hatch";

// 4 x 4 Bayer matrix, as thresholds in (0, 1): an ordered dither, so a fade or a dither reads as a pattern, not noise.
const BAYER_THRESHOLDS = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((step) => (step + 0.5) / 16);
// Below this much ink a halftone dot, a hatch stroke or a binary digit is not drawn at all (too small to read as a mark).
const MIN_DRAWN_INK = 0.08;
// A binary cell reads 1 from this much ink up, 0 under it.
const BINARY_ONE_INK = 0.55;
// The bit of each braille dot, by its column (0, 1) and row (0 to 3) in the cell (Unicode braille patterns, U+2800).
const BRAILLE_DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const;
const BRAILLE_BLANK = 0x2800;

export type Rgb = readonly [number, number, number];
/** A drawn cell: its character (empty for halftone, dither and hatch, which draw shapes), its ink in [0, 1], its colour. */
export type AsciiCell = { glyph: string; ink: number; rgb: Rgb };

/** How many samples a cell takes across and down: a braille cell reads 2 by 4, every other style one. */
export function readSamplesPerCell(style: AsciiStyle): { across: number; down: number } {
  return style === "braille" ? { across: 2, down: 4 } : { across: 1, down: 1 };
}

export type AsciiGridOptions = {
  /** The sampled picture, RGBA, row by row, `readSamplesPerCell(style)` samples per cell (a canvas's ImageData.data). */
  pixels: ArrayLike<number>;
  columns: number;
  rows: number;
  style: AsciiStyle;
  /** The glyph style's ramp (the other styles ignore it). */
  ramp: GlyphRampName;
  /** Bright patches carry little ink: for a light ground, where dark marks should carry the shapes. */
  isInverted: boolean;
  /** Every mark's colour moves this share toward `tone` (0 keeps the picture's colour). */
  tone: Rgb | null;
  toneShare: number;
  /** The last share of the rows thins out and pales toward `ground`, so the grid ends in the page (0 for none). */
  fadeShare: number;
  ground: Rgb;
};

function readBrightness(red: number, green: number, blue: number): number {
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

function mixRgb(rgb: Rgb, target: Rgb, share: number): Rgb {
  return [rgb[0] + (target[0] - rgb[0]) * share, rgb[1] + (target[1] - rgb[1]) * share, rgb[2] + (target[2] - rgb[2]) * share];
}

/** "#RRGGBB" to its channels; null for anything else. */
export function parseHexColour(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!match) return null;
  return [Number.parseInt(match[1] ?? "0", 16), Number.parseInt(match[2] ?? "0", 16), Number.parseInt(match[3] ?? "0", 16)];
}

function readBayerThreshold(row: number, column: number): number {
  return BAYER_THRESHOLDS[(row % 4) * 4 + (column % 4)] ?? 0.5;
}

/** The character a cell of the glyph-like styles shows for its ink; empty for a cell left bare. */
function pickGlyph(style: AsciiStyle, ink: number, ramp: GlyphRampName): string {
  if (style === "glyph") {
    const glyphs = GLYPH_RAMPS[ramp];
    const glyph = glyphs[Math.min(glyphs.length - 1, Math.floor(ink * glyphs.length))] ?? " ";
    return glyph === " " ? "" : glyph;
  }
  if (style === "binary") return ink < MIN_DRAWN_INK ? "" : ink >= BINARY_ONE_INK ? "1" : "0";
  return "";
}

/** The grid, row by row; a cell is null where the picture leaves the ground bare (no ink, or faded out). */
export function buildAsciiGrid({ pixels, columns, rows, style, ramp, isInverted, tone, toneShare, fadeShare, ground }: AsciiGridOptions): (AsciiCell | null)[] {
  const { across, down } = readSamplesPerCell(style);
  const sampleColumns = columns * across;
  const sampleCount = sampleColumns * rows * down;
  let lowest = 1;
  let highest = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const brightness = readBrightness(pixels[sampleIndex * 4] ?? 0, pixels[sampleIndex * 4 + 1] ?? 0, pixels[sampleIndex * 4 + 2] ?? 0);
    lowest = Math.min(lowest, brightness);
    highest = Math.max(highest, brightness);
  }
  const range = Math.max(0.01, highest - lowest);
  const readSample = (sampleRow: number, sampleColumn: number): { ink: number; rgb: Rgb } => {
    const offset = (sampleRow * sampleColumns + sampleColumn) * 4;
    const rgb: Rgb = [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0];
    const level = (readBrightness(rgb[0], rgb[1], rgb[2]) - lowest) / range;
    return { ink: isInverted ? 1 - level : level, rgb };
  };

  const cells: (AsciiCell | null)[] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowProgress = rows > 1 ? row / (rows - 1) : 0;
    const fadeProgress = fadeShare > 0 ? Math.max(0, (rowProgress - (1 - fadeShare)) / fadeShare) : 0;
    for (let column = 0; column < columns; column += 1) {
      const threshold = readBayerThreshold(row, column);
      if (fadeProgress > threshold * 1.1) {
        cells.push(null);
        continue;
      }
      // The cell's ink and colour: the mean of its samples; braille also sets a dot for each sample over its threshold.
      let inkSum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let brailleBits = 0;
      for (let subRow = 0; subRow < down; subRow += 1) {
        for (let subColumn = 0; subColumn < across; subColumn += 1) {
          const sample = readSample(row * down + subRow, column * across + subColumn);
          inkSum += sample.ink;
          red += sample.rgb[0];
          green += sample.rgb[1];
          blue += sample.rgb[2];
          if (style === "braille" && sample.ink > readBayerThreshold(row * down + subRow, column * across + subColumn)) {
            brailleBits |= BRAILLE_DOT_BITS[subColumn]?.[subRow] ?? 0;
          }
        }
      }
      const sampleTotal = across * down;
      const ink = inkSum / sampleTotal;
      let glyph = "";
      if (style === "braille") {
        if (brailleBits === 0) {
          cells.push(null);
          continue;
        }
        glyph = String.fromCharCode(BRAILLE_BLANK + brailleBits);
      } else if (style === "glyph" || style === "binary") {
        glyph = pickGlyph(style, ink, ramp);
        if (glyph === "") {
          cells.push(null);
          continue;
        }
      } else if (style === "dither" ? ink <= threshold : ink < MIN_DRAWN_INK) {
        cells.push(null);
        continue;
      }
      const sampled: Rgb = [red / sampleTotal, green / sampleTotal, blue / sampleTotal];
      const toned = tone ? mixRgb(sampled, tone, toneShare) : sampled;
      cells.push({ glyph, ink, rgb: fadeProgress > 0 ? mixRgb(toned, ground, fadeProgress * 0.6) : toned });
    }
  }
  return cells;
}

/**
 * The cell's mark for one shimmer tick: a glyph steps one place on its ramp (never to a space), a binary digit flips,
 * a braille cell gains or loses one dot. Halftone, dither and hatch hold still (their shapes would flicker).
 */
export function shiftGlyph(glyph: string, style: AsciiStyle, ramp: GlyphRampName, step: 1 | -1): string {
  if (style === "binary") return glyph === "1" ? "0" : "1";
  if (style === "braille") {
    const bits = glyph.charCodeAt(0) - BRAILLE_BLANK;
    const toggled = bits ^ (1 << ((step === 1 ? bits : bits + 3) % 8));
    return toggled === 0 ? glyph : String.fromCharCode(BRAILLE_BLANK + toggled);
  }
  if (style !== "glyph") return glyph;
  const glyphs = GLYPH_RAMPS[ramp];
  const index = glyphs.indexOf(glyph);
  if (index < 0) return glyph;
  return glyphs[Math.min(glyphs.length - 1, Math.max(1, index + step))] ?? glyph;
}

/** Whether a style's marks shimmer at all (the shapes of halftone, dither and hatch hold still). */
export function canShimmer(style: AsciiStyle): boolean {
  return style === "glyph" || style === "binary" || style === "braille";
}
