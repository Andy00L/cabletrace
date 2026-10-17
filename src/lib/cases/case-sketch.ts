import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import { positionAtTime } from "@/lib/replay/replay-scene";
import type { SeabedData, SeabedLineKind } from "@/lib/seabed/seabed-data";

// A small top-down map of one case for the case list, drawn from the same data as its 3D replay: the coastline
// from the terrain grid, the mapped cable and pipeline routes, the track with its anchor-drag stretch, and the
// cuts. Built once on the server into SVG path strings; the page ships no map code.

/** The sketch's SVG coordinate space: 640 by 360 units (16:9). */
export const SKETCH_WIDTH = 640;
export const SKETCH_HEIGHT = 360;
// Room kept around the track and the cuts, as a share of their extent, and the narrowest frame (km).
const FRAME_PADDING_SHARE = 0.16;
const MIN_FRAME_WIDTH_KM = 60;
// Land is drawn from every Nth grid point, so one land cell is at least this many SVG units wide, and each
// run reaches this far into its neighbours so antialiasing leaves no hairline seam between rows.
const MIN_LAND_CELL_UNITS = 1;
const LAND_RUN_OVERLAP_UNITS = 0.35;
// Kilometres per degree (WGS 84 mean values), as in terrain.ts.
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON_AT_EQUATOR = 111.32;

export type CaseSketch = {
  /** Land as one path of row runs. */
  landPath: string;
  lines: { kind: SeabedLineKind; path: string }[];
  trackPath: string;
  /** The stretch of track sailed while the anchor dragged, or null. */
  dragPath: string | null;
  cuts: { x: number; y: number; label: string }[];
};

type SketchPoint = { x: number; y: number };

function formatUnits(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function toPath(points: readonly SketchPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${formatUnits(point.x)} ${formatUnits(point.y)}`).join("");
}

/** Builds the sketch, framed on the track and the cuts. */
export function buildCaseSketch(seabed: SeabedData, input: ReplaySceneInput): CaseSketch {
  const { region, grid, lines } = seabed.features;
  const kmPerDegLon = KM_PER_DEG_LON_AT_EQUATOR * Math.cos((((region.north + region.south) / 2) * Math.PI) / 180);
  // Kilometres east of the west edge and south of the north edge.
  const toKm = (longitude: number, latitude: number) => ({ x: (longitude - region.west) * kmPerDegLon, y: (region.north - latitude) * KM_PER_DEG_LAT });
  const regionWidthKm = (region.east - region.west) * kmPerDegLon;
  const regionHeightKm = (region.north - region.south) * KM_PER_DEG_LAT;

  // Frame: the track and the cuts with padding, widened to 16:9, kept inside the block where it fits.
  const storyPoints = [...input.track, ...input.cuts].map((point) => toKm(point.longitude, point.latitude));
  const minX = Math.min(...storyPoints.map((point) => point.x));
  const maxX = Math.max(...storyPoints.map((point) => point.x));
  const minY = Math.min(...storyPoints.map((point) => point.y));
  const maxY = Math.max(...storyPoints.map((point) => point.y));
  const aspect = SKETCH_WIDTH / SKETCH_HEIGHT;
  const frameWidthKm = Math.max(MIN_FRAME_WIDTH_KM, (maxX - minX) * (1 + 2 * FRAME_PADDING_SHARE), (maxY - minY) * (1 + 2 * FRAME_PADDING_SHARE) * aspect);
  const frameHeightKm = frameWidthKm / aspect;
  const fitInside = (center: number, span: number, limit: number) => (span >= limit ? limit / 2 : Math.min(Math.max(center, span / 2), limit - span / 2));
  const frameCenterX = fitInside((minX + maxX) / 2, frameWidthKm, regionWidthKm);
  const frameCenterY = fitInside((minY + maxY) / 2, frameHeightKm, regionHeightKm);
  const frameLeft = frameCenterX - frameWidthKm / 2;
  const frameTop = frameCenterY - frameHeightKm / 2;
  const unitsPerKm = SKETCH_WIDTH / frameWidthKm;
  const project = (longitude: number, latitude: number): SketchPoint => {
    const km = toKm(longitude, latitude);
    return { x: (km.x - frameLeft) * unitsPerKm, y: (km.y - frameTop) * unitsPerKm };
  };

  // Land: runs of land grid points along every sampled row, each point the centre of its cell.
  const cellWidthUnits = (regionWidthKm / (grid.width - 1)) * unitsPerKm;
  const cellHeightUnits = (regionHeightKm / (grid.height - 1)) * unitsPerKm;
  const columnStride = Math.max(1, Math.ceil(MIN_LAND_CELL_UNITS / cellWidthUnits));
  const rowStride = Math.max(1, Math.ceil(MIN_LAND_CELL_UNITS / cellHeightUnits));
  const runWidth = cellWidthUnits * columnStride;
  const runHeight = cellHeightUnits * rowStride;
  const landRuns: string[] = [];
  for (let row = 0; row < grid.height; row += rowStride) {
    const top = row * cellHeightUnits - frameTop * unitsPerKm - runHeight / 2;
    if (top > SKETCH_HEIGHT || top + runHeight < 0) continue;
    let runStart: number | null = null;
    for (let column = 0; column <= grid.width; column += columnStride) {
      const isLand = column < grid.width && (seabed.elevations[row * grid.width + column] ?? -1) > 0;
      if (isLand && runStart === null) runStart = column;
      if (!isLand && runStart !== null) {
        const left = runStart * cellWidthUnits - frameLeft * unitsPerKm - runWidth / 2;
        const width = (column - runStart) * cellWidthUnits;
        const drawnWidth = width + LAND_RUN_OVERLAP_UNITS;
        const drawnHeight = runHeight + LAND_RUN_OVERLAP_UNITS;
        if (left < SKETCH_WIDTH && left + width > 0) landRuns.push(`M${formatUnits(left)} ${formatUnits(top)}h${formatUnits(drawnWidth)}v${formatUnits(drawnHeight)}h${formatUnits(-drawnWidth)}z`);
        runStart = null;
      }
    }
  }

  const sketchLines = lines.map((line) => ({ kind: line.kind, path: toPath(line.points.map(([longitude, latitude]) => project(longitude, latitude))) }));
  const trackPath = toPath(input.track.map((position) => project(position.longitude, position.latitude)));

  // The drag stretch: the interpolated start, every track point inside the window, the interpolated end.
  let dragPath: string | null = null;
  const dragWindow = input.dragWindow;
  const firstPosition = input.track[0];
  if (dragWindow && firstPosition) {
    const startMs = Math.max(dragWindow.startMs, firstPosition.atMs);
    const start = positionAtTime(input.track, startMs);
    const end = positionAtTime(input.track, dragWindow.endMs);
    const inside = input.track.filter((position) => position.atMs > startMs && position.atMs < dragWindow.endMs);
    const dragPositions = [start, ...inside, end].filter((position) => position !== null);
    if (dragPositions.length >= 2) dragPath = toPath(dragPositions.map((position) => project(position.longitude, position.latitude)));
  }

  return {
    landPath: landRuns.join(""),
    lines: sketchLines,
    trackPath,
    dragPath,
    cuts: input.cuts.map((cut) => ({ ...project(cut.longitude, cut.latitude), label: cut.label })),
  };
}
