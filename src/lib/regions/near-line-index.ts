// A grid index over seed lines that answers "is this point within N metres of a line, and which one", the same test
// public.ingest_vessel_positions runs in PostGIS. Used offline to measure how many positions a region would store
// before its seed is applied (scripts/regions/measure-coverage.ts).
import type { Coordinate, SeedLine } from "@/lib/regions/line-network";
import { pointToSegmentMetres } from "@/lib/regions/line-network";

// Cell edge in degrees. 0.05 degrees is 5.6 km north to south, wider than the 3 km test, so a query reads one cell.
const CELL_DEGREES = 0.05;
// Degrees of latitude per metre on the mean Earth sphere (111,195 m a degree, src/lib/detection/geodesy.ts radius).
const DEGREES_PER_METRE = 1 / 111_195;

type IndexedSegment = { lineIndex: number; start: Coordinate; end: Coordinate };

export type NearLineIndex = {
  /** The nearest line within the index's reach and its distance in metres, or null when none is that close. */
  findNearest: (point: Coordinate) => { lineIndex: number; distanceMetres: number } | null;
};

function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

/** Indexes every segment of `lines` into every cell its bounding box, grown by `reachMetres`, touches. */
export function createNearLineIndex(lines: readonly SeedLine[], reachMetres: number): NearLineIndex {
  const cells = new Map<string, IndexedSegment[]>();
  const reachLatitude = reachMetres * DEGREES_PER_METRE;
  lines.forEach((line, lineIndex) => {
    for (const part of line.parts) {
      for (let pointIndex = 1; pointIndex < part.length; pointIndex += 1) {
        const start = part[pointIndex - 1];
        const end = part[pointIndex];
        if (start === undefined || end === undefined) continue;
        const middleLatitude = (start[1] + end[1]) / 2;
        const reachLongitude = reachLatitude / Math.max(0.05, Math.cos((middleLatitude * Math.PI) / 180));
        const firstColumn = Math.floor((Math.min(start[0], end[0]) - reachLongitude) / CELL_DEGREES);
        const lastColumn = Math.floor((Math.max(start[0], end[0]) + reachLongitude) / CELL_DEGREES);
        const firstRow = Math.floor((Math.min(start[1], end[1]) - reachLatitude) / CELL_DEGREES);
        const lastRow = Math.floor((Math.max(start[1], end[1]) + reachLatitude) / CELL_DEGREES);
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          for (let row = firstRow; row <= lastRow; row += 1) {
            const key = cellKey(column, row);
            const segments = cells.get(key) ?? [];
            segments.push({ lineIndex, start, end });
            cells.set(key, segments);
          }
        }
      }
    }
  });
  return {
    findNearest: (point) => {
      const segments = cells.get(cellKey(Math.floor(point[0] / CELL_DEGREES), Math.floor(point[1] / CELL_DEGREES))) ?? [];
      let nearest: { lineIndex: number; distanceMetres: number } | null = null;
      for (const segment of segments) {
        const distance = pointToSegmentMetres(point, segment.start, segment.end);
        if (distance <= reachMetres && (nearest === null || distance < nearest.distanceMetres)) nearest = { lineIndex: segment.lineIndex, distanceMetres: distance };
      }
      return nearest;
    },
  };
}
