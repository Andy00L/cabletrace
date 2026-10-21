import { chooseSceneExaggeration } from "@/lib/seabed/scene-scales";
import { chooseScenePalette } from "@/lib/seabed/scene/scene-look";
import { buildTerrainGrid, type TerrainGrid } from "@/lib/seabed/scene/terrain-grid";
import type { SeabedData, SeabedFeatures } from "@/lib/seabed/seabed-data";
import { chooseSmoothingPasses, createProjection } from "@/lib/seabed/terrain";

// What the 3D replay draws a seabed area from: its features and its terrain's arrays, built from the area's files in
// one pure step, so the terrain worker (terrain-worker.ts) and the main-thread fallback (seabed-scene-load.ts) make the
// same thing. No three.js and no DOM here.

/** The area's features (lines, places, region, credits) and its terrain, built for one tier's grid step. */
export type SeabedScene = { features: SeabedFeatures; terrain: TerrainGrid };

/**
 * Every `step`-th row and column of the grid is drawn: all of them on a GPU, every second one on a CPU renderer and on
 * a phone (src/lib/render/compact-screen.ts).
 */
export const TERRAIN_STEPS = { gpu: 1, software: 2, compact: 2 } as const;

/** Builds the terrain of an area's data at a grid step, in the look the area draws in (scene-look.ts). */
export function buildSeabedScene(data: SeabedData, step: number): SeabedScene {
  const { features } = data;
  const projection = createProjection(features.region);
  const palette = chooseScenePalette(features.region);
  const terrain = buildTerrainGrid({
    elevations: data.elevations,
    grid: features.grid,
    step,
    smoothingPasses: chooseSmoothingPasses(features.sources.depth),
    exaggeration: chooseSceneExaggeration(features.elevationRange),
    widthKm: projection.widthKm,
    depthKm: projection.depthKm,
    depthRamp: palette.depthRamp,
    landRamp: palette.landRamp,
  });
  return { features: { ...features, grid: terrain.grid }, terrain };
}
