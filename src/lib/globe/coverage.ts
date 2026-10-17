import { COORDINATE_UNITS_PER_DEGREE, type ShipFrameColumns } from "@/lib/live/snapshot-codec";

// Where the feeds heard ships, from the frames the page has loaded: a world grid of half-degree cells, a cell marked
// heard when any loaded frame holds a ship in it. The globe hatches the sea outside the heard cells, so an empty
// ocean reads as "no receiver hears this", not "no ship is here" (terrestrial AIS ends a few tens of km offshore).

// Half a degree is 55.6 km of latitude. A heard ship marks its cell and the eight around it, so "heard" means
// within one to two cells (about 55 to 110 km) of a ship some receiver picked up; the legend says "about 55 km".
export const COVERAGE_CELL_DEGREES = 0.5;
export const COVERAGE_WIDTH = 360 / COVERAGE_CELL_DEGREES;
export const COVERAGE_HEIGHT = 180 / COVERAGE_CELL_DEGREES;
// Mask values the globe's shader reads (0 blind, 255 heard).
const HEARD = 255;

export type Coverage = {
  /** One byte per cell, row 0 at the north pole and column 0 at 180 W: 1 where a loaded frame heard a ship. */
  heardCells: Uint8Array;
  /** Frame times already counted, so a frame loaded twice counts once. */
  frameTimes: Set<number>;
};

export function createCoverage(): Coverage {
  return { heardCells: new Uint8Array(COVERAGE_WIDTH * COVERAGE_HEIGHT), frameTimes: new Set() };
}

/** The cell a position falls in; 180 E shares the 180 W column and the poles their edge rows. */
export function coverageCellIndex(longitude: number, latitude: number): number {
  const column = ((Math.floor((longitude + 180) / COVERAGE_CELL_DEGREES) % COVERAGE_WIDTH) + COVERAGE_WIDTH) % COVERAGE_WIDTH;
  const row = Math.min(COVERAGE_HEIGHT - 1, Math.max(0, Math.floor((90 - latitude) / COVERAGE_CELL_DEGREES)));
  return row * COVERAGE_WIDTH + column;
}

/** Marks the cells of every ship in a frame. Returns false when the frame was already counted. */
export function addFrameToCoverage(coverage: Coverage, frame: Pick<ShipFrameColumns, "frameTimeMs" | "shipCount" | "longitudeUnits" | "latitudeUnits">): boolean {
  if (coverage.frameTimes.has(frame.frameTimeMs)) return false;
  coverage.frameTimes.add(frame.frameTimeMs);
  for (let shipIndex = 0; shipIndex < frame.shipCount; shipIndex += 1) {
    const longitude = (frame.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    const latitude = (frame.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    coverage.heardCells[coverageCellIndex(longitude, latitude)] = 1;
  }
  return true;
}

/**
 * The mask the globe draws: every heard cell and its eight neighbours at 255, the rest 0. Columns wrap at the
 * 180th meridian; rows stop at the poles.
 */
export function renderCoverageMask(coverage: Coverage): Uint8Array {
  const mask = new Uint8Array(COVERAGE_WIDTH * COVERAGE_HEIGHT);
  for (let row = 0; row < COVERAGE_HEIGHT; row += 1) {
    for (let column = 0; column < COVERAGE_WIDTH; column += 1) {
      if (coverage.heardCells[row * COVERAGE_WIDTH + column] !== 1) continue;
      for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
        const neighbourRow = row + rowStep;
        if (neighbourRow < 0 || neighbourRow >= COVERAGE_HEIGHT) continue;
        for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
          const neighbourColumn = (column + columnStep + COVERAGE_WIDTH) % COVERAGE_WIDTH;
          mask[neighbourRow * COVERAGE_WIDTH + neighbourColumn] = HEARD;
        }
      }
    }
  }
  return mask;
}
