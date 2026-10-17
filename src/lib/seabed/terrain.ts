import { clampValue, interpolate } from "@/lib/seabed/math";
import type { SceneExaggeration } from "@/lib/seabed/scene-scales";

export type SeabedRegion = { west: number; east: number; south: number; north: number };
export type SeabedGrid = { width: number; height: number };
/** A point on the overview block, in kilometres: x grows east, z grows south. */
export type ScenePoint = { x: number; z: number };

export type Projection = {
  widthKm: number;
  depthKm: number;
  toScene: (longitude: number, latitude: number) => ScenePoint;
};

// Kilometres per degree (WGS 84 mean values).
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON_AT_EQUATOR = 111.32;
// Lines stop this far inside the block edge so tubes never poke through its sides.
const BLOCK_EDGE_MARGIN_KM = 0.15;

/** Decodes little-endian int16 decimetres into metres (negative under water). */
export function decodeElevations(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const elevations = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true) / 10;
  }
  return elevations;
}

/** Softens single-cell spikes with a 3x3 mean; land and sea are averaged separately so the coastline stays put. */
export function smoothElevations(elevations: Float32Array, grid: SeabedGrid, passes: number): Float32Array {
  let current = elevations;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(current.length);
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const isLand = (current[row * grid.width + column] ?? 0) >= 0;
        let sum = 0;
        let count = 0;
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
            const neighbourRow = row + rowOffset;
            const neighbourColumn = column + columnOffset;
            if (neighbourRow < 0 || neighbourRow >= grid.height || neighbourColumn < 0 || neighbourColumn >= grid.width) continue;
            const neighbour = current[neighbourRow * grid.width + neighbourColumn] ?? 0;
            if (neighbour >= 0 !== isLand) continue;
            sum += neighbour;
            count += 1;
          }
        }
        next[row * grid.width + column] = sum / count;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Keeps every `step`-th row and column, for renderers that cannot afford the full grid. The kept grid must still
 * reach both edges of the region, so a grid whose size does not divide evenly comes back unchanged.
 */
export function downsampleElevations(elevations: Float32Array, grid: SeabedGrid, step: number): { elevations: Float32Array; grid: SeabedGrid } {
  const isDivisible = step >= 2 && (grid.width - 1) % step === 0 && (grid.height - 1) % step === 0;
  if (!isDivisible) return { elevations, grid };
  const reducedGrid = { width: (grid.width - 1) / step + 1, height: (grid.height - 1) / step + 1 };
  const reduced = new Float32Array(reducedGrid.width * reducedGrid.height);
  for (let row = 0; row < reducedGrid.height; row += 1) {
    for (let column = 0; column < reducedGrid.width; column += 1) {
      reduced[row * reducedGrid.width + column] = elevations[row * step * grid.width + column * step] ?? 0;
    }
  }
  return { elevations: reduced, grid: reducedGrid };
}

/** Overview scene height (km) of an elevation in metres, at the area's exaggeration (chooseSceneExaggeration). */
export function elevationToSceneY(elevationMetres: number, exaggeration: SceneExaggeration): number {
  return (elevationMetres / 1000) * (elevationMetres >= 0 ? exaggeration.land : exaggeration.water);
}

/** Equirectangular projection around the region's centre latitude; the block is centred on the origin. */
export function createProjection(region: SeabedRegion): Projection {
  const centerLatitude = (region.south + region.north) / 2;
  const widthKm = (region.east - region.west) * KM_PER_DEG_LON_AT_EQUATOR * Math.cos((centerLatitude * Math.PI) / 180);
  const depthKm = (region.north - region.south) * KM_PER_DEG_LAT;
  return {
    widthKm,
    depthKm,
    toScene(longitude, latitude) {
      return {
        x: ((longitude - region.west) / (region.east - region.west) - 0.5) * widthKm,
        z: ((region.north - latitude) / (region.north - region.south) - 0.5) * depthKm,
      };
    },
  };
}

/** Bilinear elevation in metres under an overview scene point; points outside the grid read its nearest edge. */
export function createElevationSampler(elevations: Float32Array, grid: SeabedGrid, projection: Projection) {
  const lastColumn = grid.width - 1;
  const lastRow = grid.height - 1;
  const readElevation = (row: number, column: number) => elevations[row * grid.width + column] ?? 0;
  return function sampleElevationMetres(sceneX: number, sceneZ: number): number {
    const column = clampValue((sceneX / projection.widthKm + 0.5) * lastColumn, 0, lastColumn);
    const row = clampValue((sceneZ / projection.depthKm + 0.5) * lastRow, 0, lastRow);
    const leftColumn = Math.floor(column);
    const topRow = Math.floor(row);
    const rightColumn = Math.min(leftColumn + 1, lastColumn);
    const bottomRow = Math.min(topRow + 1, lastRow);
    const columnAmount = column - leftColumn;
    const rowAmount = row - topRow;
    const topElevation = interpolate(readElevation(topRow, leftColumn), readElevation(topRow, rightColumn), columnAmount);
    const bottomElevation = interpolate(readElevation(bottomRow, leftColumn), readElevation(bottomRow, rightColumn), columnAmount);
    return interpolate(topElevation, bottomElevation, rowAmount);
  };
}

/** Adds points every `stepKm` so a line can follow the seabed between soundings. */
export function densifyScenePoints(points: readonly ScenePoint[], stepKm: number): ScenePoint[] {
  const result: ScenePoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(length / stepKm));
    for (let step = 0; step < steps; step += 1) {
      const amount = step / steps;
      result.push({ x: interpolate(start.x, end.x, amount), z: interpolate(start.z, end.z, amount) });
    }
  }
  const lastPoint = points[points.length - 1];
  if (lastPoint) result.push(lastPoint);
  return result;
}

/** Splits a polyline into the runs that stay inside the block; runs shorter than 3 points are dropped. */
export function clipToBlock(points: readonly ScenePoint[], projection: Projection): ScenePoint[][] {
  const halfWidth = projection.widthKm / 2 - BLOCK_EDGE_MARGIN_KM;
  const halfDepth = projection.depthKm / 2 - BLOCK_EDGE_MARGIN_KM;
  const runs: ScenePoint[][] = [];
  let currentRun: ScenePoint[] = [];
  for (const point of points) {
    const isInside = Math.abs(point.x) <= halfWidth && Math.abs(point.z) <= halfDepth;
    if (isInside) {
      currentRun.push(point);
    } else if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);
  return runs.filter((run) => run.length >= 3);
}
