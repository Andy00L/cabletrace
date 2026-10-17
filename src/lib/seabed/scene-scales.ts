// How much larger than life the 3D seabed draws things. The scene reads these to draw, and the replay reads
// them to say so under the view, so the disclosure can never drift from the picture. No three.js import here:
// the page bundle reads this file too.

export const SCENE_SCALES = {
  /** Overview: the vessel drawn this many times its real size, so it reads across a 145 to 300 km block. */
  shipDrawnScale: 6,
  /** Overview: the anchor drawn this many times its real size. */
  anchorDrawnScale: 30,
  /** Close-up: the anchor and its chain drawn this many times their real size (the police gave about 4 by 2.5 m). */
  closeUpAnchorScale: 2,
} as const;

/** Overview: how many times deeper water and higher land are drawn than they are, for one seabed area. */
export type SceneExaggeration = { water: number; land: number };

// The steps an area's exaggeration is picked from, largest first, so the disclosure reads as a round number. The
// shallow seas keep 20 (water) and 10 (land): 120 m of relief reads across the 145 km Gulf of Finland block without
// turning narrow shoals into needles.
const WATER_EXAGGERATION_STEPS = [20, 10, 5, 3, 2, 1] as const;
const LAND_EXAGGERATION_STEPS = [10, 5, 3, 2, 1] as const;
// The tallest relief an exaggerated area may draw (km). At 20 times, Svalbard's 3,200 m drop would be 64 km of
// cliff in a 220 km block and hide its cut behind it; the Baltic's deepest block (248 m, 5 km drawn) stays at 20.
const MAX_DRAWN_RELIEF_KM = 7;

function pickExaggerationStep(steps: readonly number[], reliefMetres: number): number {
  return steps.find((step) => (Math.abs(reliefMetres) * step) / 1000 <= MAX_DRAWN_RELIEF_KM) ?? 1;
}

/**
 * The exaggeration for an area, from the deepest and highest points of its grid (each seabed file's
 * `elevationRange`): the largest step that keeps the drawn relief within MAX_DRAWN_RELIEF_KM. Land is never drawn
 * taller than water is drawn deep, so one area's two scales stay comparable.
 */
export function chooseSceneExaggeration(range: { lowestMetres: number; highestMetres: number }): SceneExaggeration {
  const water = pickExaggerationStep(WATER_EXAGGERATION_STEPS, range.lowestMetres);
  return { water, land: Math.min(water, pickExaggerationStep(LAND_EXAGGERATION_STEPS, range.highestMetres)) };
}

/** The sentence under the overview, top and vessel views. */
export function describeOverviewScale(exaggeration: SceneExaggeration): string {
  const depth = exaggeration.water === 1 ? "Depth is drawn at true scale" : `Depth is drawn ${exaggeration.water} times deeper`;
  const land = exaggeration.land === 1 ? "land at true scale" : `land ${exaggeration.land} times higher`;
  return `${depth} and ${land}; the ship is drawn ${SCENE_SCALES.shipDrawnScale} times and the anchor ${SCENE_SCALES.anchorDrawnScale} times their size.`;
}

/** The sentences under the close-up, for its measured and illustrated modes. */
export const CLOSE_UP_SCALE_NOTES = {
  illustrated: `Close-up: the anchor is drawn ${SCENE_SCALES.closeUpAnchorScale} times its size and the cable thicker than life; sand, rocks and the furrow are drawn in.`,
  measured: "Close-up, measured: only the depth grid under the cut, smoothed between its points; nothing is drawn in.",
} as const;
