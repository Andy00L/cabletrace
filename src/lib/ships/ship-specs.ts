import type { ShipKind } from "@/lib/replay/replay-scene";

// The shape of each ship type, as proportions of its length, for the parametric hull generator (build-ship.ts).
// No three.js here: the specs are plain data any page can read. The proportions are drawn values chosen so each
// type reads as itself at a glance (ship type reads through silhouette and size: plan, ambition pass 13). They start
// from the case ships where one exists (Yi Peng 3 224 by 32 m, draught 14.5 m: anchor-model.ts) and are not a survey
// of any one hull, except the tanker: it is Eagle S (IMO 9329760, 228.6 by 32.3 m), read off the public-domain side
// photograph "Eagle S Emasalo 2025-01-12 1" (Wikimedia Commons, by MKFI) as shares of its length: a raked stem
// overhanging the waterline by 3% of the length, a low forecastle with a bulwark, a freeboard of about 9.3 m at the
// photograph's draught, the house front 20% of the length from the stern and its aft end at 5%, the bridge roof about
// 24 m above the water, the funnel 8 to 10% from the stern. The photo match (scripts/lookdev/photo-match) judges the
// built hull against that photograph.

/** Where the bridge and accommodation stand. */
export type SuperstructurePlacement = "aft" | "forward" | "midship" | "full-length";

/**
 * The accommodation: `tiers` counts the decks under the bridge (2.9 m each). An aft house gives its front and its
 * length as shares of the ship's length from the stern.
 */
export type Superstructure =
  | { placement: "aft"; frontFromSternShare: number; lengthShare: number; tiers: number }
  | { placement: "forward" | "midship" | "full-length"; tiers: number };

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
  /** Deck rise above the moulded depth at the bow and at the stern (shares of the depth): the sheer line. */
  sheerForwardToDepth: number;
  sheerAftToDepth: number;
  /** How far the counter stern overhangs aft of the rudder post above the water (share of the length). */
  counterToLength: number;
  /** Bulwark height around the forecastle (m), 0 for none. */
  bulwarkMetres: number;
  superstructure: Superstructure;
};

export const SHIP_SPECS: Record<ShipKind, ShipSpec> = {
  // Eagle S (see the file comment).
  tanker: {
    beamToLength: 0.1413,
    depthToLength: 0.09,
    draughtToLength: 0.055,
    bulbToBeam: 0.096,
    bowEntranceShare: 0.45,
    sternRunShare: 0.55,
    stemRakeToDepth: 0.3,
    forecastleRiseToDepth: 0.05,
    sheerForwardToDepth: 0.02,
    sheerAftToDepth: 0.01,
    counterToLength: 0.022,
    bulwarkMetres: 1.2,
    superstructure: { placement: "aft", frontFromSternShare: 0.2, lengthShare: 0.15, tiers: 4 },
  },
  "bulk-carrier": {
    beamToLength: 0.143,
    depthToLength: 0.088,
    draughtToLength: 0.06,
    bulbToBeam: 0.09,
    bowEntranceShare: 0.42,
    sternRunShare: 0.55,
    stemRakeToDepth: 0.22,
    forecastleRiseToDepth: 0.13,
    sheerForwardToDepth: 0.02,
    sheerAftToDepth: 0.01,
    counterToLength: 0.02,
    bulwarkMetres: 1.2,
    superstructure: { placement: "aft", frontFromSternShare: 0.17, lengthShare: 0.12, tiers: 5 },
  },
  "general-cargo": {
    beamToLength: 0.155,
    depthToLength: 0.085,
    draughtToLength: 0.058,
    bulbToBeam: 0.08,
    bowEntranceShare: 0.36,
    sternRunShare: 0.48,
    stemRakeToDepth: 0.24,
    forecastleRiseToDepth: 0.16,
    sheerForwardToDepth: 0.04,
    sheerAftToDepth: 0.015,
    counterToLength: 0.022,
    bulwarkMetres: 1.1,
    superstructure: { placement: "aft", frontFromSternShare: 0.18, lengthShare: 0.12, tiers: 4 },
  },
  "container-ship": {
    beamToLength: 0.155,
    depthToLength: 0.083,
    draughtToLength: 0.052,
    bulbToBeam: 0.1,
    bowEntranceShare: 0.3,
    sternRunShare: 0.42,
    stemRakeToDepth: 0.26,
    forecastleRiseToDepth: 0.14,
    sheerForwardToDepth: 0.03,
    sheerAftToDepth: 0.01,
    counterToLength: 0.025,
    bulwarkMetres: 1.4,
    superstructure: { placement: "aft", frontFromSternShare: 0.19, lengthShare: 0.09, tiers: 6 },
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
    sheerForwardToDepth: 0.12,
    sheerAftToDepth: 0.02,
    counterToLength: 0.01,
    bulwarkMetres: 1,
    superstructure: { placement: "forward", tiers: 1 },
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
    sheerForwardToDepth: 0.1,
    sheerAftToDepth: 0.02,
    counterToLength: 0.01,
    bulwarkMetres: 0.9,
    superstructure: { placement: "midship", tiers: 2 },
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
    sheerForwardToDepth: 0.02,
    sheerAftToDepth: 0,
    counterToLength: 0.015,
    bulwarkMetres: 1.2,
    superstructure: { placement: "full-length", tiers: 4 },
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
    sheerForwardToDepth: 0.06,
    sheerAftToDepth: 0.01,
    counterToLength: 0.02,
    bulwarkMetres: 1.2,
    superstructure: { placement: "full-length", tiers: 7 },
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
    sheerForwardToDepth: 0.04,
    sheerAftToDepth: 0.01,
    counterToLength: 0.012,
    bulwarkMetres: 1.1,
    superstructure: { placement: "forward", tiers: 4 },
  },
};

/** Every ship kind, in a stable order (the lookdev turntable and the tests walk it). */
export const SHIP_KINDS = Object.keys(SHIP_SPECS).filter((kind): kind is ShipKind => kind in SHIP_SPECS);
