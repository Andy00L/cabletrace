import type { RgbaImage } from "../png";

// Segments a ship from a side-on photograph taken across open water, without a model of the ship: every row's
// background (sky, the far shore's trees, water) is learned from columns outside the ship (left of the bow and right
// of the stern), and a pixel is the ship when its colour is far from every background colour of its row band. The
// photograph is the outside judge (photo-match.ts), so nothing here may know what the 3D model looks like.
//
// Pixels where the call is close (the deck gear seen against the dark trees of the far shore, whose colours overlap
// the gear's) are marked void: neither ship nor background, left out of the intersection over union in both masks, as
// segmentation benchmarks leave out their "void" borders (PASCAL VOC 2012, Everingham et al.). The report gives the
// score with and without them.

/** One mask per pixel, row-major: 1 set, 0 clear. */
export type Mask = { width: number; height: number; data: Uint8Array };

export type SegmentOptions = {
  /**
   * The box the ship lies in, as shares of the width and height ([left, top, right, bottom]). Everything outside it is
   * background, the way a box seeds an interactive segmentation (GrabCut, Rother et al. 2004): the box says where to
   * look, never what the ship's outline is.
   */
  shipBox: readonly [number, number, number, number];
  /** Round 0 calls a pixel ship when it lies this far (RGB distance, 0 to 441) from every background colour of its band. */
  seedDistance: number;
  /** A pixel is ship when it lies this much nearer the ship's colours than the background's (RGB distance). */
  shipMargin: number;
  /** A pixel is void when its distances to the ship and the background colours differ by less than this (RGB, 0 to 441) on a dark-background row. */
  voidMargin: number;
  /** A row's background is "dark" (the far shore's trees) when its median luminance falls under this (0 to 255). */
  darkBackgroundLuminance: number;
  /** Ship components smaller than this many pixels are dropped (sun sparkles on the water, birds). */
  minComponentPixels: number;
  /**
   * The hull is solid paint from the waterline up: in each column, gaps up to `hullGapShare` of the image height are
   * filled between ship pixels lying within `hullReachShare` of the height above the column's lowest ship pixel (a
   * vertical closing kept to the hull band, so the sky under a crane's jib stays open).
   */
  hullGapShare: number;
  hullReachShare: number;
};

export type Segmentation = { ship: Mask; voidMask: Mask; shipPixelCount: number; voidPixelCount: number };

// Background colours per row band: k-means over the band's background pixels.
const CLUSTER_COUNT = 8;
const CLUSTER_ITERATIONS = 8;
// Rows on each side of a row that share its background model.
const BAND_HALF_ROWS = 3;

// A pixel's features: red, green, blue and its local texture (the luminance's standard deviation over a 5 x 5 window,
// times TEXTURE_WEIGHT). Paint is smooth and the far shore's trees are not, which separates a dark hull from dark
// trees whose colours are the same.
type Rgb = [number, number, number, number];
const TEXTURE_WEIGHT = 2.5;
const TEXTURE_HALF_WINDOW = 2;

function readLuminanceAt(image: RgbaImage, column: number, row: number): number {
  const offset = (Math.min(image.height - 1, Math.max(0, row)) * image.width + Math.min(image.width - 1, Math.max(0, column))) * 4;
  return 0.2126 * (image.data[offset] ?? 0) + 0.7152 * (image.data[offset + 1] ?? 0) + 0.0722 * (image.data[offset + 2] ?? 0);
}

/** Local texture of every pixel (see Rgb), computed once per image. */
function measureTexture(image: RgbaImage): Float32Array {
  const texture = new Float32Array(image.width * image.height);
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      let sum = 0;
      let sumOfSquares = 0;
      let count = 0;
      for (let rowOffset = -TEXTURE_HALF_WINDOW; rowOffset <= TEXTURE_HALF_WINDOW; rowOffset += 1) {
        for (let columnOffset = -TEXTURE_HALF_WINDOW; columnOffset <= TEXTURE_HALF_WINDOW; columnOffset += 1) {
          const luminance = readLuminanceAt(image, column + columnOffset, row + rowOffset);
          sum += luminance;
          sumOfSquares += luminance * luminance;
          count += 1;
        }
      }
      const mean = sum / count;
      texture[row * image.width + column] = TEXTURE_WEIGHT * Math.sqrt(Math.max(0, sumOfSquares / count - mean * mean));
    }
  }
  return texture;
}

let activeTexture: Float32Array | null = null;

function readPixel(image: RgbaImage, column: number, row: number): Rgb {
  const offset = (row * image.width + column) * 4;
  return [image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0, activeTexture?.[row * image.width + column] ?? 0];
}

function measureDistance(first: Rgb, second: Rgb): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2], first[3] - second[3]);
}

function measureLuminance(color: Rgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/** k-means with centres seeded evenly through the samples sorted by luminance (deterministic: no random seeding). */
function clusterColors(samples: Rgb[]): Rgb[] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((first, second) => measureLuminance(first) - measureLuminance(second));
  let centres: Rgb[] = Array.from({ length: Math.min(CLUSTER_COUNT, sorted.length) }, (_slot, index) => {
    const picked = sorted[Math.floor(((index + 0.5) / Math.min(CLUSTER_COUNT, sorted.length)) * sorted.length)];
    return picked ? [...picked] : [0, 0, 0, 0];
  });
  for (let iteration = 0; iteration < CLUSTER_ITERATIONS; iteration += 1) {
    const sums = centres.map((): [number, number, number, number, number] => [0, 0, 0, 0, 0]);
    for (const sample of samples) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centres.forEach((centre, index) => {
        const distance = measureDistance(sample, centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      const sum = sums[bestIndex];
      if (!sum) continue;
      sum[0] += sample[0];
      sum[1] += sample[1];
      sum[2] += sample[2];
      sum[3] += sample[3];
      sum[4] += 1;
    }
    centres = centres.map((centre, index) => {
      const sum = sums[index];
      return sum && sum[4] > 0 ? [sum[0] / sum[4], sum[1] / sum[4], sum[2] / sum[4], sum[3] / sum[4]] : centre;
    });
  }
  return centres;
}

function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Clears connected components (4-neighbour) of set pixels smaller than `minPixels`; returns the set count left. */
function dropSmallComponents(mask: Mask, minPixels: number): number {
  const { width, height, data } = mask;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let keptCount = 0;
  for (let start = 0; start < data.length; start += 1) {
    if (data[start] !== 1 || visited[start] === 1) continue;
    const component: number[] = [];
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      component.push(index);
      const column = index % width;
      const neighbours = [index - width, index + width, column > 0 ? index - 1 : -1, column < width - 1 ? index + 1 : -1];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= data.length || data[neighbour] !== 1 || visited[neighbour] === 1) continue;
        visited[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    if (component.length < minPixels) component.forEach((index) => (data[index] = 0));
    else keptCount += component.length;
  }
  return keptCount;
}

// A column's lowest ship pixel within this many pixels of the fitted waterline sits on the water.
const WATERLINE_TOLERANCE_PX = 3;

function readMedian(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The hull-band vertical closing (see SegmentOptions.hullGapShare). The waterline is a straight line through the
 * medians of each half's lowest ship pixels (a photo's waterline is straight; a single column can lose its boot top to
 * the water's colours), and each column is closed upward from it.
 */
function closeHullColumns(mask: Mask, maxGapPx: number, reachPx: number) {
  const { width, height, data } = mask;
  const lowestRows: { column: number; row: number }[] = [];
  for (let column = 0; column < width; column += 1) {
    for (let row = height - 1; row >= 0; row -= 1) {
      if (data[row * width + column] === 1) {
        lowestRows.push({ column, row });
        break;
      }
    }
  }
  if (lowestRows.length < 2) return;
  const half = Math.floor(lowestRows.length / 2);
  const leftHalf = lowestRows.slice(0, half);
  const rightHalf = lowestRows.slice(half);
  const leftColumn = readMedian(leftHalf.map((entry) => entry.column));
  const rightColumn = readMedian(rightHalf.map((entry) => entry.column));
  const leftRow = readMedian(leftHalf.map((entry) => entry.row));
  const rightRow = readMedian(rightHalf.map((entry) => entry.row));
  const slope = rightColumn === leftColumn ? 0 : (rightRow - leftRow) / (rightColumn - leftColumn);
  const readWaterlineRow = (column: number) => Math.round(leftRow + slope * (column - leftColumn));
  // The hull meets the water from the first column whose lowest ship pixel lies on the waterline (ahead of it the raked
  // stem overhangs the water) to the last column with ship within reach above it: the side photograph's stern is lit
  // brown-grey where the low sun strikes it, close to the far shore's colours, and loses its boot top to the water,
  // while the poop deck above it is found. Eagle S's counter overhangs the water by a few pixels there.
  const waterlineColumns = lowestRows.filter((entry) => Math.abs(entry.row - readWaterlineRow(entry.column)) <= WATERLINE_TOLERANCE_PX).map((entry) => entry.column);
  const firstColumn = waterlineColumns.reduce((first, column) => Math.min(first, column), width);
  const lastColumn = lowestRows.filter((entry) => readWaterlineRow(entry.column) - entry.row <= reachPx).reduce((last, entry) => Math.max(last, entry.column), -1);
  for (const { column } of lowestRows) {
    if (column < firstColumn || column > lastColumn) continue;
    const waterlineRow = readWaterlineRow(column);
    let lastSetRow = waterlineRow + 1;
    for (let row = waterlineRow; row >= Math.max(0, waterlineRow - reachPx); row -= 1) {
      if (data[row * width + column] !== 1) continue;
      if (lastSetRow - row > 1 && lastSetRow - row <= maxGapPx) for (let gapRow = row + 1; gapRow < lastSetRow; gapRow += 1) data[gapRow * width + column] = 1;
      lastSetRow = row;
    }
  }
}

// Holes up to this many pixels are filled (a dark window, a gap between pipes); a larger enclosed region is sky seen
// through a frame (the triangle between a crane's jib, its strut and the deck) and stays background.
const MAX_HOLE_PIXELS = 300;

/** Sets the small clear regions the image border cannot reach through clear pixels (holes inside the ship). */
function fillHoles(mask: Mask) {
  const { width, height, data } = mask;
  const reached = new Uint8Array(width * height);
  const stack: number[] = [];
  const seed = (index: number) => {
    if (data[index] === 0 && reached[index] === 0) {
      reached[index] = 1;
      stack.push(index);
    }
  };
  for (let column = 0; column < width; column += 1) {
    seed(column);
    seed((height - 1) * width + column);
  }
  for (let row = 0; row < height; row += 1) {
    seed(row * width);
    seed(row * width + width - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    const column = index % width;
    if (index >= width) seed(index - width);
    if (index < (height - 1) * width) seed(index + width);
    if (column > 0) seed(index - 1);
    if (column < width - 1) seed(index + 1);
  }
  // Each unreached region is a hole; only the small ones are filled.
  const visited = new Uint8Array(width * height);
  for (let start = 0; start < data.length; start += 1) {
    if (data[start] !== 0 || reached[start] === 1 || visited[start] === 1) continue;
    const region: number[] = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < region.length; cursor += 1) {
      const index = region[cursor] ?? 0;
      const column = index % width;
      const neighbours = [index - width, index + width, column > 0 ? index - 1 : -1, column < width - 1 ? index + 1 : -1];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= data.length || data[neighbour] !== 0 || reached[neighbour] === 1 || visited[neighbour] === 1) continue;
        visited[neighbour] = 1;
        region.push(neighbour);
      }
    }
    if (region.length <= MAX_HOLE_PIXELS) region.forEach((index) => (data[index] = 1));
  }
}

// Rounds of re-learning the ship's colours from the pixels last called ship.
const REFINE_ROUNDS = 4;
// At most this many pixels feed the ship's colour model each round (evenly strided).
const SHIP_MODEL_SAMPLES = 24000;

/** Sets each pixel to the majority of its 3 x 3 neighbourhood (inside the box), smoothing single-pixel noise. */
function smoothMajority(mask: Mask, box: { left: number; top: number; right: number; bottom: number }) {
  const copy = Uint8Array.from(mask.data);
  for (let row = Math.max(1, box.top); row < Math.min(mask.height - 1, box.bottom); row += 1) {
    for (let column = Math.max(1, box.left); column < Math.min(mask.width - 1, box.right); column += 1) {
      let setCount = 0;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) setCount += copy[(row + rowOffset) * mask.width + column + columnOffset] ?? 0;
      }
      mask.data[row * mask.width + column] = setCount >= 5 ? 1 : 0;
    }
  }
}

/** The ship and void masks of a photograph (see the file comment). */
export function segmentShip(image: RgbaImage, options: SegmentOptions): Segmentation {
  const { width, height } = image;
  activeTexture = measureTexture(image);
  const ship = createMask(width, height);
  const voidMask = createMask(width, height);
  const box = {
    left: Math.floor(options.shipBox[0] * width),
    top: Math.floor(options.shipBox[1] * height),
    right: Math.ceil(options.shipBox[2] * width),
    bottom: Math.ceil(options.shipBox[3] * height),
  };
  // Background colours per row band, from the columns outside the box on both sides.
  const bandCentres: Rgb[][] = [];
  const darkRows: boolean[] = [];
  for (let row = 0; row < height; row += 1) {
    const samples: Rgb[] = [];
    for (let bandRow = Math.max(0, row - BAND_HALF_ROWS); bandRow <= Math.min(height - 1, row + BAND_HALF_ROWS); bandRow += 1) {
      for (let column = 0; column < width; column += column < box.left || column >= box.right ? 1 : box.right - box.left) {
        if (column >= box.left && column < box.right) continue;
        samples.push(readPixel(image, column, bandRow));
      }
    }
    bandCentres.push(clusterColors(samples));
    const luminances = samples.map(measureLuminance).sort((first, second) => first - second);
    darkRows.push((luminances[Math.floor(luminances.length / 2)] ?? 255) < options.darkBackgroundLuminance);
  }
  const distanceTo = (color: Rgb, centres: readonly Rgb[]) => centres.reduce((nearest, centre) => Math.min(nearest, measureDistance(color, centre)), Number.POSITIVE_INFINITY);
  // Round 0 calls ship only what no background colour comes near; each round then learns the ship's colours from the
  // last answer and calls each pixel by the nearer model.
  for (let row = box.top; row < box.bottom; row += 1) {
    const backgroundCentres = bandCentres[row] ?? [];
    for (let column = box.left; column < box.right; column += 1) ship.data[row * width + column] = distanceTo(readPixel(image, column, row), backgroundCentres) >= options.seedDistance ? 1 : 0;
  }
  const margins = new Float32Array(width * height);
  for (let round = 0; round < REFINE_ROUNDS; round += 1) {
    const shipSamples: Rgb[] = [];
    let setCount = 0;
    for (let index = 0; index < ship.data.length; index += 1) setCount += ship.data[index] ?? 0;
    const stride = Math.max(1, Math.floor(setCount / SHIP_MODEL_SAMPLES));
    let seen = 0;
    for (let index = 0; index < ship.data.length; index += 1) {
      if (ship.data[index] !== 1) continue;
      if (seen % stride === 0) shipSamples.push(readPixel(image, index % width, Math.floor(index / width)));
      seen += 1;
    }
    const shipCentres = clusterColors(shipSamples).concat(clusterColors(shipSamples.slice(0, Math.floor(shipSamples.length / 2))));
    for (let row = box.top; row < box.bottom; row += 1) {
      const backgroundCentres = bandCentres[row] ?? [];
      for (let column = box.left; column < box.right; column += 1) {
        const color = readPixel(image, column, row);
        const margin = distanceTo(color, backgroundCentres) - distanceTo(color, shipCentres);
        margins[row * width + column] = margin;
        ship.data[row * width + column] = margin > options.shipMargin ? 1 : 0;
      }
    }
    smoothMajority(ship, box);
  }
  dropSmallComponents(ship, options.minComponentPixels);
  closeHullColumns(ship, Math.round(options.hullGapShare * height), Math.round(options.hullReachShare * height));
  fillHoles(ship);
  let shipPixelCount = 0;
  for (let index = 0; index < ship.data.length; index += 1) shipPixelCount += ship.data[index] ?? 0;
  let voidPixelCount = 0;
  for (let row = box.top; row < box.bottom; row += 1) {
    if (!darkRows[row]) continue;
    for (let column = box.left; column < box.right; column += 1) {
      const index = row * width + column;
      if (ship.data[index] === 0 && Math.abs(margins[index] ?? 0) < options.voidMargin) {
        voidMask.data[index] = 1;
        voidPixelCount += 1;
      }
    }
  }
  return { ship, voidMask, shipPixelCount, voidPixelCount };
}

/**
 * Intersection over union of two masks of the same size, leaving out every pixel set in `voidMask` (or none when
 * null). Returns null when the sizes differ or the union is empty.
 */
export function measureIntersectionOverUnion(first: Mask, second: Mask, voidMask: Mask | null): number | null {
  if (first.width !== second.width || first.height !== second.height) return null;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.data.length; index += 1) {
    if (voidMask && voidMask.data[index] === 1) continue;
    const isFirst = first.data[index] === 1;
    const isSecond = second.data[index] === 1;
    if (isFirst && isSecond) intersection += 1;
    if (isFirst || isSecond) union += 1;
  }
  return union === 0 ? null : intersection / union;
}
