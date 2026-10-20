import { writeUnitVector } from "@/lib/globe/sphere";
import { COORDINATE_UNITS_PER_DEGREE, type ShipFrameColumns } from "@/lib/live/snapshot-codec";

// The Planet tier's ship density: the frame's ships counted in cells of about equal area, each drawn as one dot whose
// area grows with its count (a graduated dot map, the cartographer's density figure). Bands of 2 degrees of latitude,
// each cut into as many cells as keep a cell about 2 by 2 degrees on the ground (fewer toward the poles), so a dot
// stands for the same area of sea everywhere.

/** The columns of a frame that place its ships. */
type FramePositions = Pick<ShipFrameColumns, "shipCount" | "longitudeUnits" | "latitudeUnits">;

// 2 degrees is about 220 km: a dot per strait or approach at Planet distance, about 7 px apart on a 1440 px screen.
const BAND_DEGREES = 2;
const BAND_COUNT = 180 / BAND_DEGREES;
const RADIANS_PER_DEGREE = Math.PI / 180;

type CellLayout = { columnsPerBand: Int32Array; bandStart: Int32Array; cellCount: number };

function buildCellLayout(): CellLayout {
  const columnsPerBand = new Int32Array(BAND_COUNT);
  const bandStart = new Int32Array(BAND_COUNT);
  let cellCount = 0;
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const centreLatitude = 90 - (band + 0.5) * BAND_DEGREES;
    columnsPerBand[band] = Math.max(1, Math.round((360 / BAND_DEGREES) * Math.cos(centreLatitude * RADIANS_PER_DEGREE)));
    bandStart[band] = cellCount;
    cellCount += columnsPerBand[band] ?? 1;
  }
  return { columnsPerBand, bandStart, cellCount };
}

const CELL_LAYOUT = buildCellLayout();

/** The cells holding ships: their centres on the unit sphere (3 numbers each) and how many ships each holds. */
export type ShipDensity = { cellCount: number; positions: Float32Array; counts: Float32Array };

/** Which cell a point falls in. */
export function findDensityCell(longitude: number, latitude: number): number {
  const band = Math.min(BAND_COUNT - 1, Math.max(0, Math.floor((90 - latitude) / BAND_DEGREES)));
  const columns = CELL_LAYOUT.columnsPerBand[band] ?? 1;
  const wrappedLongitude = (((longitude + 180) % 360) + 360) % 360;
  const column = Math.min(columns - 1, Math.floor((wrappedLongitude / 360) * columns));
  return (CELL_LAYOUT.bandStart[band] ?? 0) + column;
}

function writeCellCentre(cell: number, target: Float32Array, offset: number): void {
  let band = 0;
  while (band + 1 < BAND_COUNT && (CELL_LAYOUT.bandStart[band + 1] ?? 0) <= cell) band += 1;
  const columns = CELL_LAYOUT.columnsPerBand[band] ?? 1;
  const column = cell - (CELL_LAYOUT.bandStart[band] ?? 0);
  writeUnitVector(-180 + ((column + 0.5) / columns) * 360, 90 - (band + 0.5) * BAND_DEGREES, target, offset);
}

/** Counts a frame's ships per cell and lists the occupied cells. */
export function binShipDensity(frame: FramePositions): ShipDensity {
  const countsByCell = new Uint32Array(CELL_LAYOUT.cellCount);
  for (let shipIndex = 0; shipIndex < frame.shipCount; shipIndex += 1) {
    const cell = findDensityCell((frame.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE, (frame.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE);
    countsByCell[cell] = (countsByCell[cell] ?? 0) + 1;
  }
  let occupiedCount = 0;
  for (const count of countsByCell) if (count > 0) occupiedCount += 1;
  const positions = new Float32Array(occupiedCount * 3);
  const counts = new Float32Array(occupiedCount);
  let written = 0;
  countsByCell.forEach((count, cell) => {
    if (count === 0) return;
    writeCellCentre(cell, positions, written * 3);
    counts[written] = count;
    written += 1;
  });
  return { cellCount: occupiedCount, positions, counts };
}
