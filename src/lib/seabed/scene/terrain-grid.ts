import type { SceneExaggeration } from "@/lib/seabed/scene-scales";
import { bakeReliefOcclusion } from "@/lib/seabed/scene/relief-occlusion";
import { downsampleElevations, elevationToSceneY, smoothElevations, type SeabedGrid } from "@/lib/seabed/terrain";

// The overview terrain's geometry as plain typed arrays, computed off the main thread (terrain-worker.ts) while the
// renderer starts, so a case page draws its first frame sooner (docs/PERFORMANCE.md, Case load). No three.js here:
// the arrays are what THREE.PlaneGeometry rotated flat, its heights set and computeVertexNormals would hold, vertex
// for vertex (terrain-grid.test.ts checks the normals against three.js), plus the vertex colours from the look's
// ramps and the baked relief occlusion.

/** What the terrain is built from: the area's grid as decoded, how the tier draws it, and the look's colour ramps. */
export type TerrainGridRequest = {
  elevations: Float32Array;
  grid: SeabedGrid;
  /** Keep every `step`-th row and column (the software tier draws half the grid). */
  step: number;
  smoothingPasses: number;
  exaggeration: SceneExaggeration;
  widthKm: number;
  depthKm: number;
  depthRamp: readonly [number, string][];
  landRamp: readonly [number, string][];
};

/** The drawn grid and its smoothed elevations (metres), and the mesh's attributes, row 0 at the block's north edge. */
export type TerrainGrid = {
  grid: SeabedGrid;
  elevations: Float32Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Vertex colours in linear light, as THREE.Color holds them. */
  colors: Float32Array;
  occlusion: Float32Array;
  indices: Uint32Array | Uint16Array;
};

/** An sRGB hex colour as linear channels, as THREE.Color(hex) stores it under three.js's colour management. */
function hexToLinear(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const decode = (encoded: number) => (encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4);
  return [decode(((value >> 16) & 255) / 255), decode(((value >> 8) & 255) / 255), decode((value & 255) / 255)];
}

type LinearRamp = { value: number; color: [number, number, number] }[];

function toLinearRamp(stops: readonly [number, string][]): LinearRamp {
  return stops.map(([value, hex]) => ({ value, color: hexToLinear(hex) }));
}

/** The ramp's colour at `value`, blended in linear light between its stops and held at its ends; written at `offset`. */
function writeRampColor(ramp: LinearRamp, value: number, target: Float32Array, offset: number) {
  const first = ramp[0];
  const last = ramp[ramp.length - 1];
  if (!first || !last) return;
  let lower = first;
  let upper = first;
  if (value > first.value) {
    lower = last;
    upper = last;
    for (let index = 1; index < ramp.length; index += 1) {
      const candidate = ramp[index];
      const previous = ramp[index - 1];
      if (candidate && previous && value <= candidate.value) {
        lower = previous;
        upper = candidate;
        break;
      }
    }
  }
  const amount = upper.value > lower.value ? (value - lower.value) / (upper.value - lower.value) : 0;
  for (let channel = 0; channel < 3; channel += 1) target[offset + channel] = lower.color[channel] + (upper.color[channel] - lower.color[channel]) * amount;
}

/**
 * Area-weighted vertex normals of the grid's triangles, as BufferGeometry.computeVertexNormals gives them for
 * PlaneGeometry's index order (each cell split into a, b, d and b, c, d).
 */
function computeGridNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const first = (indices[triangle] ?? 0) * 3;
    const second = (indices[triangle + 1] ?? 0) * 3;
    const third = (indices[triangle + 2] ?? 0) * 3;
    // (third - second) x (first - second), three.js's winding.
    const towardThirdX = (positions[third] ?? 0) - (positions[second] ?? 0);
    const towardThirdY = (positions[third + 1] ?? 0) - (positions[second + 1] ?? 0);
    const towardThirdZ = (positions[third + 2] ?? 0) - (positions[second + 2] ?? 0);
    const towardFirstX = (positions[first] ?? 0) - (positions[second] ?? 0);
    const towardFirstY = (positions[first + 1] ?? 0) - (positions[second + 1] ?? 0);
    const towardFirstZ = (positions[first + 2] ?? 0) - (positions[second + 2] ?? 0);
    const normalX = towardThirdY * towardFirstZ - towardThirdZ * towardFirstY;
    const normalY = towardThirdZ * towardFirstX - towardThirdX * towardFirstZ;
    const normalZ = towardThirdX * towardFirstY - towardThirdY * towardFirstX;
    for (const vertex of [first, second, third]) {
      normals[vertex] = (normals[vertex] ?? 0) + normalX;
      normals[vertex + 1] = (normals[vertex + 1] ?? 0) + normalY;
      normals[vertex + 2] = (normals[vertex + 2] ?? 0) + normalZ;
    }
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(normals[vertex] ?? 0, normals[vertex + 1] ?? 0, normals[vertex + 2] ?? 0) || 1;
    normals[vertex] = (normals[vertex] ?? 0) / length;
    normals[vertex + 1] = (normals[vertex + 1] ?? 0) / length;
    normals[vertex + 2] = (normals[vertex + 2] ?? 0) / length;
  }
  return normals;
}

/** Builds the terrain's arrays (see TerrainGrid). Pure: the same request always gives the same arrays. */
export function buildTerrainGrid(request: TerrainGridRequest): TerrainGrid {
  const reduced = downsampleElevations(request.elevations, request.grid, request.step);
  const elevations = smoothElevations(reduced.elevations, reduced.grid, request.smoothingPasses);
  const { width: columns, height: rows } = reduced.grid;
  const vertexCount = columns * rows;
  const cellWidthKm = request.widthKm / (columns - 1);
  const cellDepthKm = request.depthKm / (rows - 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const sceneHeights = new Float32Array(vertexCount);
  const depthRamp = toLinearRamp(request.depthRamp);
  const landRamp = toLinearRamp(request.landRamp);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const elevation = elevations[index] ?? 0;
      const sceneY = elevationToSceneY(elevation, request.exaggeration);
      sceneHeights[index] = sceneY;
      positions[index * 3] = column * cellWidthKm - request.widthKm / 2;
      positions[index * 3 + 1] = sceneY;
      positions[index * 3 + 2] = row * cellDepthKm - request.depthKm / 2;
      uvs[index * 2] = column / (columns - 1);
      uvs[index * 2 + 1] = 1 - row / (rows - 1);
      if (elevation < 0) writeRampColor(depthRamp, -elevation, colors, index * 3);
      else writeRampColor(landRamp, elevation, colors, index * 3);
    }
  }
  const indexCount = (columns - 1) * (rows - 1) * 6;
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const topLeft = column + columns * row;
      const bottomLeft = column + columns * (row + 1);
      const bottomRight = column + 1 + columns * (row + 1);
      const topRight = column + 1 + columns * row;
      indices.set([topLeft, bottomLeft, topRight, bottomLeft, bottomRight, topRight], cursor);
      cursor += 6;
    }
  }
  return {
    grid: reduced.grid,
    elevations,
    positions,
    normals: computeGridNormals(positions, indices),
    uvs,
    colors,
    occlusion: bakeReliefOcclusion(sceneHeights, columns, rows, cellWidthKm, cellDepthKm),
    indices,
  };
}

/** Every array of a grid, for handing it across threads without a copy. */
export function listTerrainGridBuffers(terrain: TerrainGrid): ArrayBuffer[] {
  return [terrain.elevations, terrain.positions, terrain.normals, terrain.uvs, terrain.colors, terrain.occlusion, terrain.indices].flatMap((array) => (array.buffer instanceof ArrayBuffer ? [array.buffer] : []));
}
