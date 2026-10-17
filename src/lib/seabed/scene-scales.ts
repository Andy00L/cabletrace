// How much larger than life the 3D seabed draws things. The scene reads these to draw, and the replay reads
// them to say so under the view, so the disclosure can never drift from the picture. No three.js import here:
// the page bundle reads this file too.

export const SCENE_SCALES = {
  /** Overview: water depth drawn this many times deeper than it is. */
  waterExaggeration: 20,
  /** Overview: land drawn this many times higher than it is. */
  landExaggeration: 10,
  /** Overview: the vessel drawn this many times its real size, so it reads across a 145 km block. */
  shipDrawnScale: 6,
  /** Overview: the anchor drawn this many times its real size. */
  anchorDrawnScale: 30,
  /** Close-up: the anchor and its chain drawn this many times their real size (the police gave about 4 by 2.5 m). */
  closeUpAnchorScale: 2,
} as const;

/** The sentence under the overview, top and vessel views. */
export const OVERVIEW_SCALE_NOTE = `Depth is drawn ${SCENE_SCALES.waterExaggeration} times deeper and land ${SCENE_SCALES.landExaggeration} times higher; the ship is drawn ${SCENE_SCALES.shipDrawnScale} times and the anchor ${SCENE_SCALES.anchorDrawnScale} times their size.`;

/** The sentences under the close-up, for its measured and illustrated modes. */
export const CLOSE_UP_SCALE_NOTES = {
  illustrated: `Close-up: the anchor is drawn ${SCENE_SCALES.closeUpAnchorScale} times its size and the cable thicker than life; sand, rocks and the furrow are drawn in.`,
  measured: "Close-up, measured: only the surveyed depth under the cut, one point every 115 m.",
} as const;
