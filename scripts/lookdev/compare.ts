import type { RgbaImage } from "./png";

// Image checks for the lookdev harness: a perceptual difference against an approved baseline, and exact data colours
// at points the viewer says a data line is drawn.

// Largest possible YIQ difference between two colours (Kotsarenko and Ramos, "Measuring perceived color difference
// using YIQ NTSC transmission color space in mobile applications", 2010; the same constant pixelmatch uses).
const MAX_YIQ_DELTA = 35215;

export type ImageDifference = {
  /** Pixels whose perceived difference is over the per-pixel threshold. */
  differingPixels: number;
  differingShare: number;
  /** Mean perceived difference over every pixel, as a share of the largest possible (0 to 1). */
  meanDelta: number;
  /** The candidate in grey with differing pixels in red, for a person to look at. */
  diffImage: RgbaImage;
};

/** Averages each `factor` x `factor` block into one pixel (a box filter): baselines are kept at a fraction of the frame. */
export function downscaleImage(image: RgbaImage, factor: number): RgbaImage {
  if (factor <= 1) return image;
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8Array(width * height * 4);
  const blockArea = factor * factor;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        let sum = 0;
        for (let blockRow = 0; blockRow < factor; blockRow += 1) {
          for (let blockColumn = 0; blockColumn < factor; blockColumn += 1) {
            sum += image.data[((row * factor + blockRow) * image.width + column * factor + blockColumn) * 4 + channel] ?? 0;
          }
        }
        data[(row * width + column) * 4 + channel] = Math.round(sum / blockArea);
      }
    }
  }
  return { width, height, data };
}

function readYiqDelta(first: Uint8Array, second: Uint8Array, offset: number): number {
  const redDelta = (first[offset] ?? 0) - (second[offset] ?? 0);
  const greenDelta = (first[offset + 1] ?? 0) - (second[offset + 1] ?? 0);
  const blueDelta = (first[offset + 2] ?? 0) - (second[offset + 2] ?? 0);
  const luma = redDelta * 0.29889531 + greenDelta * 0.58662247 + blueDelta * 0.11448223;
  const inPhase = redDelta * 0.59597799 - greenDelta * 0.2741761 - blueDelta * 0.32180189;
  const quadrature = redDelta * 0.21147017 - greenDelta * 0.52261711 + blueDelta * 0.31114694;
  return 0.5053 * luma * luma + 0.299 * inPhase * inPhase + 0.1957 * quadrature * quadrature;
}

/**
 * Perceived difference between two frames of the same size. A pixel differs when its YIQ difference passes
 * `pixelThreshold` (0 to 1, as a share of the largest difference measured in YIQ units, squared like pixelmatch's).
 */
export function compareImages(baseline: RgbaImage, candidate: RgbaImage, pixelThreshold: number): ImageDifference | null {
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) return null;
  const pixelCount = baseline.width * baseline.height;
  const limit = MAX_YIQ_DELTA * pixelThreshold * pixelThreshold;
  const diffData = new Uint8Array(pixelCount * 4);
  let differingPixels = 0;
  let deltaSum = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const delta = readYiqDelta(baseline.data, candidate.data, offset);
    deltaSum += delta / MAX_YIQ_DELTA;
    const grey = Math.round(255 - 0.25 * (255 - ((candidate.data[offset] ?? 0) * 0.3 + (candidate.data[offset + 1] ?? 0) * 0.59 + (candidate.data[offset + 2] ?? 0) * 0.11)));
    const isDiffering = delta > limit;
    if (isDiffering) differingPixels += 1;
    diffData[offset] = isDiffering ? 217 : grey;
    diffData[offset + 1] = isDiffering ? 58 : grey;
    diffData[offset + 2] = isDiffering ? 38 : grey;
    diffData[offset + 3] = 255;
  }
  return {
    differingPixels,
    differingShare: differingPixels / pixelCount,
    meanDelta: deltaSum / pixelCount,
    diffImage: { width: baseline.width, height: baseline.height, data: diffData },
  };
}

export type RgbColor = { red: number; green: number; blue: number };

/** "#2F6BD8" to its channels. */
export function parseHexColor(hex: string): RgbColor {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return { red: (value >> 16) & 0xff, green: (value >> 8) & 0xff, blue: value & 0xff };
}

export function formatHexColor(color: RgbColor): string {
  return `#${[color.red, color.green, color.blue].map((channel) => channel.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

export type ProbeMatch = { deviation: number; found: RgbColor };

/**
 * The pixel within `radiusPx` of a point whose colour is nearest `expected`, and its largest channel difference.
 * The neighbourhood absorbs sub-pixel placement: a 2 px line seldom covers the exact pixel its centre falls in.
 */
export function matchColorNear(image: RgbaImage, centerX: number, centerY: number, expected: RgbColor, radiusPx: number): ProbeMatch | null {
  let best: ProbeMatch | null = null;
  const firstColumn = Math.max(0, Math.round(centerX) - radiusPx);
  const lastColumn = Math.min(image.width - 1, Math.round(centerX) + radiusPx);
  const firstRow = Math.max(0, Math.round(centerY) - radiusPx);
  const lastRow = Math.min(image.height - 1, Math.round(centerY) + radiusPx);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const offset = (row * image.width + column) * 4;
      const found = { red: image.data[offset] ?? 0, green: image.data[offset + 1] ?? 0, blue: image.data[offset + 2] ?? 0 };
      const deviation = Math.max(Math.abs(found.red - expected.red), Math.abs(found.green - expected.green), Math.abs(found.blue - expected.blue));
      if (best === null || deviation < best.deviation) best = { deviation, found };
    }
  }
  return best;
}
