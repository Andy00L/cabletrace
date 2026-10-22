// The ASCII layer's arithmetic (docs/UI_DESIGN_SYSTEM.md, ASCII layer): a picture sampled to one pixel per cell
// becomes a grid of glyphs, each in the colour of the patch it replaces. Brightness picks the glyph, stretched to the
// patch's own range so a dim painting still shows its shapes. Pure, so it is tested without a browser; the canvas
// side is src/components/ascii/AsciiPicture.tsx.

/** Glyphs from empty to full. `dense` reads shapes best at small cells; `fine` gives more steps for big cells. */
export const GLYPH_RAMPS = {
  dense: " .:-=+*#%@",
  fine: " .'`^,:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@",
} as const;
export type GlyphRampName = keyof typeof GLYPH_RAMPS;

// 4 x 4 Bayer matrix, as thresholds in (0, 1): an ordered dither, so a fade thins the glyphs in a pattern, not noise.
const BAYER_THRESHOLDS = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((step) => (step + 0.5) / 16);

export type Rgb = readonly [number, number, number];
export type AsciiCell = { glyph: string; rgb: Rgb };

export type AsciiGridOptions = {
  /** The sampled picture, RGBA, one pixel per cell, row by row (a canvas's ImageData.data). */
  pixels: ArrayLike<number>;
  columns: number;
  rows: number;
  ramp: GlyphRampName;
  /** Bright patches get sparse glyphs: for a light ground, where dark ink should carry the shapes. */
  isInverted: boolean;
  /** Every glyph's colour moves this share toward `tone` (0 keeps the picture's colour). */
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

/** The glyph grid, row by row; a cell is null where the picture leaves the ground bare (a space or a faded cell). */
export function buildAsciiGrid({ pixels, columns, rows, ramp, isInverted, tone, toneShare, fadeShare, ground }: AsciiGridOptions): (AsciiCell | null)[] {
  const glyphs = GLYPH_RAMPS[ramp];
  const cellCount = columns * rows;
  let lowest = 1;
  let highest = 0;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const brightness = readBrightness(pixels[cellIndex * 4] ?? 0, pixels[cellIndex * 4 + 1] ?? 0, pixels[cellIndex * 4 + 2] ?? 0);
    lowest = Math.min(lowest, brightness);
    highest = Math.max(highest, brightness);
  }
  const range = Math.max(0.01, highest - lowest);
  const cells: (AsciiCell | null)[] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowProgress = rows > 1 ? row / (rows - 1) : 0;
    const fadeProgress = fadeShare > 0 ? Math.max(0, (rowProgress - (1 - fadeShare)) / fadeShare) : 0;
    for (let column = 0; column < columns; column += 1) {
      const pixelOffset = (row * columns + column) * 4;
      const sampled: Rgb = [pixels[pixelOffset] ?? 0, pixels[pixelOffset + 1] ?? 0, pixels[pixelOffset + 2] ?? 0];
      const level = (readBrightness(sampled[0], sampled[1], sampled[2]) - lowest) / range;
      const glyph = glyphs[Math.min(glyphs.length - 1, Math.floor((isInverted ? 1 - level : level) * glyphs.length))] ?? " ";
      const threshold = BAYER_THRESHOLDS[(row % 4) * 4 + (column % 4)] ?? 0.5;
      if (glyph === " " || fadeProgress > threshold * 1.1) {
        cells.push(null);
        continue;
      }
      const toned = tone ? mixRgb(sampled, tone, toneShare) : sampled;
      cells.push({ glyph, rgb: fadeProgress > 0 ? mixRgb(toned, ground, fadeProgress * 0.6) : toned });
    }
  }
  return cells;
}

/** A glyph one step denser or sparser on the ramp, for the shimmer; never a space, so a cell never blinks out. */
export function shiftGlyph(glyph: string, ramp: GlyphRampName, step: 1 | -1): string {
  const glyphs = GLYPH_RAMPS[ramp];
  const index = glyphs.indexOf(glyph);
  if (index < 0) return glyph;
  return glyphs[Math.min(glyphs.length - 1, Math.max(1, index + step))] ?? glyph;
}
