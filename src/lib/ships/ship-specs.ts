import type { ShipKind } from "@/lib/replay/replay-scene";

// The shape of each ship type, as proportions of its length, for the parametric hull generator (build-ship.ts).
// No three.js here: the specs are plain data any page can read. The proportions are drawn values chosen so each
// type reads as itself at a glance (ship type reads through silhouette and size, never colour: plan, ambition pass
// 13). They start from the case ships where one exists (Eagle S 228.6 by 32.2 m, draught 12.5 m; Yi Peng 3 224 by
// 32 m, draught 14.5 m: anchor-model.ts) and are not a survey of any one hull.

/** Where the bridge and accommodation stand. */
export type SuperstructurePlacement = "aft" | "forward" | "midship" | "full-length";

export type ShipSpec = {
  beamToLength: number;
  /** Moulded depth, keel to the main deck at the side. */
  depthToLength: number;
  draughtToLength: number;
  /** Bulb radius as a share of the beam, 0 for a plain stem. */
  bulbToBeam: number;
  /** Where the parallel midbody gives way to the bow and to the stern (shares of the half length). */
  bowEntranceShare: number;
  sternRunShare: number;
  /** How far the stem rakes forward from keel to deck (share of the depth). */
  stemRakeToDepth: number;
  forecastleRiseToDepth: number;
  superstructure: SuperstructurePlacement;
  /** Accommodation tiers above the main deck, each 2.9 m. */
  superstructureTiers: number;
};

export const SHIP_SPECS: Record<ShipKind, ShipSpec> = {
  tanker: {
    beamToLength: 0.141,
    depthToLength: 0.09,
    draughtToLength: 0.055,
    bulbToBeam: 0.096,
    bowEntranceShare: 0.45,
    sternRunShare: 0.55,
    stemRakeToDepth: 0.17,
    forecastleRiseToDepth: 0.13,
    superstructure: "aft",
    superstructureTiers: 5,
  },
  "bulk-carrier": {
    beamToLength: 0.143,
    depthToLength: 0.088,
    draughtToLength: 0.06,
    bulbToBeam: 0.09,
    bowEntranceShare: 0.42,
    sternRunShare: 0.55,
    stemRakeToDepth: 0.17,
    forecastleRiseToDepth: 0.13,
    superstructure: "aft",
    superstructureTiers: 5,
  },
  "general-cargo": {
    beamToLength: 0.155,
    depthToLength: 0.085,
    draughtToLength: 0.058,
    bulbToBeam: 0.08,
    bowEntranceShare: 0.36,
    sternRunShare: 0.48,
    stemRakeToDepth: 0.2,
    forecastleRiseToDepth: 0.16,
    superstructure: "aft",
    superstructureTiers: 4,
  },
  "container-ship": {
    beamToLength: 0.155,
    depthToLength: 0.083,
    draughtToLength: 0.052,
    bulbToBeam: 0.1,
    bowEntranceShare: 0.3,
    sternRunShare: 0.42,
    stemRakeToDepth: 0.22,
    forecastleRiseToDepth: 0.14,
    superstructure: "aft",
    superstructureTiers: 6,
  },
  // A stern trawler: short and beamy, wheelhouse forward, a gantry and ramp over the stern.
  fishing: {
    beamToLength: 0.24,
    depthToLength: 0.13,
    draughtToLength: 0.09,
    bulbToBeam: 0,
    bowEntranceShare: 0.3,
    sternRunShare: 0.35,
    stemRakeToDepth: 0.35,
    forecastleRiseToDepth: 0.3,
    superstructure: "forward",
    superstructureTiers: 1,
  },
  // A harbour tug: almost a third as wide as long, deep, a tall wheelhouse forward of amidships.
  tug: {
    beamToLength: 0.34,
    depthToLength: 0.18,
    draughtToLength: 0.13,
    bulbToBeam: 0,
    bowEntranceShare: 0.15,
    sternRunShare: 0.25,
    stemRakeToDepth: 0.3,
    forecastleRiseToDepth: 0.25,
    superstructure: "midship",
    superstructureTiers: 2,
  },
  // A ro-ro cargo ship: high-sided enclosed vehicle decks from end to end, bridge at the front, a stern ramp.
  "ro-ro": {
    beamToLength: 0.16,
    depthToLength: 0.1,
    draughtToLength: 0.04,
    bulbToBeam: 0.09,
    bowEntranceShare: 0.32,
    sternRunShare: 0.4,
    stemRakeToDepth: 0.2,
    forecastleRiseToDepth: 0,
    superstructure: "full-length",
    superstructureTiers: 4,
  },
  // A passenger ferry: decks of cabins and lounges over most of the length, the funnel aft of amidships.
  passenger: {
    beamToLength: 0.16,
    depthToLength: 0.07,
    draughtToLength: 0.035,
    bulbToBeam: 0.09,
    bowEntranceShare: 0.3,
    sternRunShare: 0.4,
    stemRakeToDepth: 0.3,
    forecastleRiseToDepth: 0,
    superstructure: "full-length",
    superstructureTiers: 7,
  },
  // A cable layer: bridge forward, cable tanks amidships, a sheave over the bow and the stern for laying and repair.
  "cable-layer": {
    beamToLength: 0.19,
    depthToLength: 0.095,
    draughtToLength: 0.06,
    bulbToBeam: 0,
    bowEntranceShare: 0.32,
    sternRunShare: 0.38,
    stemRakeToDepth: 0.25,
    forecastleRiseToDepth: 0.15,
    superstructure: "forward",
    superstructureTiers: 4,
  },
};

/** Every ship kind, in a stable order (the lookdev turntable and the tests walk it). */
export const SHIP_KINDS = Object.keys(SHIP_SPECS).filter((kind): kind is ShipKind => kind in SHIP_SPECS);
