import { boxCorners, fitProjection, iso, type Flat, type Plan, type Point3, type Projection } from "@/components/iso/iso-kit";
import { paidOutForLayback, type AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";
import { SHIP_SPECS } from "@/lib/ships/ship-specs";

// The anchor figure's world, in metres: x along the track (the ship heads +x), y across it (the viewer looks from +y
// and a little ahead), z up from the seabed. The block follows the ship, so the hawse stays at x = 0 and the seabed
// slides aft under it. The block is a cutaway of the water from just aft of the anchor to just ahead of the stem: the
// bow, the chain, its touchdown, the anchor and the cable it cuts in one frame. Length and depth share one scale; the
// anchor, its chain and the cable are drawn larger than life (DRAWN_SCALES), as the replay draws them larger too.
// Plain numbers only: the server's art, the audit script and the live engine all build from this.

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 400;
const VIEW_PAD = 10;
export const AZIMUTH = 56;
export const ELEVATION = 28;

/** The block of sea: its floor plan, the clay under the seabed (z 0) and the plinth it stands on. */
export const BLOCK: Plan = { x: -170, y: -24, w: 188, d: 64, r: 0 };
export const SEDIMENT_BOTTOM = -10;
export const PLINTH: Plan = { x: BLOCK.x - 3, y: BLOCK.y - 3, w: BLOCK.w + 6, d: BLOCK.d + 6, r: 1.5 };
export const PLINTH_BOTTOM = -14;
export const FOOT_HEIGHT = 2.6;
/** The seabed texture repeats every this many metres along the track, so it can slide aft forever (m). */
export const TEXTURE_PERIOD_METRES = 96;
/** Where the anchor's crown may come at most aft: inside the block with room for the furrow behind it (m). */
const CROWN_AFT_LIMIT = BLOCK.x + 16;
/** Where the tour and the resting frame keep the crown: a little aft of the block's middle, so the anchor, its
 * touchdown and the cable it meets sit near the centre of the figure (a share of the block's length from its aft end). */
const CROWN_TOUR_SHARE = 0.42;

/** How much larger than life the small things are drawn, so they read at the block's scale. */
export const DRAWN_SCALES = {
  /** The anchor, about 4 by 2.5 m (the police figure the replay's close-up uses: src/lib/seabed/scene-scales.ts). */
  anchor: 7,
  /** The chain's links: a common stud link is about six chain diameters long (84 mm chain from the anchor model). */
  chainLink: 6,
} as const;
/** The cable's drawn radius (m): 2.2 m across, far thicker than life, as the replay's close-up draws it thicker. */
const CABLE_DRAWN_RADIUS = 1.1;

/** The police: the anchor about 4 m long and 2.5 m wide (sourceRef src/lib/seabed/scene-scales.ts, closeUpAnchorScale). */
const ANCHOR_LENGTH_METRES = 4;
const ANCHOR_WIDTH_METRES = 2.5;
// The anchor's other proportions, as shares of its length: a Spek stockless anchor's dimension row (Red Anchor,
// 900 kg Spek, redanchor.ru, read 21 Oct 2026: A 1440, B 1100, C 480, D 240, E 50, F 800 mm; the sheet gives no key,
// read here as A shank length, C crown length, D shank depth at the crown, E shackle pin diameter, F fluke length).
const SPEK_SHARE = { crown: 480 / 1440, shankDepth: 240 / 1440, pin: 50 / 1440, fluke: 800 / 1440 } as const;
// A common stud link is six chain diameters long and 3.6 wide (ISO 1704 proportions).
const STUD_LINK_LENGTH_TO_DIAMETER = 6;
const STUD_LINK_WIDTH_TO_DIAMETER = 3.6;

export type AnchorDims = {
  shank: number;
  shankDepth: number;
  shankWidth: number;
  crownLength: number;
  crownDepth: number;
  halfWidth: number;
  fluke: number;
  flukeWidth: number;
  thickness: number;
  pin: number;
};

export type FigureView = {
  projection: Projection;
  depth: number;
  /** The chain leaves the starboard hawse, swings out clear of the bow, and runs aft just outside the hull's beam. */
  chainY: number;
  hawse: Point3;
  ship: { stemX: number; sternX: number; halfBeam: number; draught: number; freeboard: number; keelZ: number; deckZ: number; length: number };
  anchor: AnchorDims;
  link: { length: number; width: number };
  cableRadius: number;
  /** The chain the reader can pay out in the figure: from hanging clear to the length that keeps the anchor in the block. */
  paidOutRange: [number, number];
  /** The chain the idle tour pays out at most, and the resting frame shows: the anchor near the block's middle. */
  tourPaidOut: number;
};

/** Half the breadth of the hull at x (m): an elliptic entrance forward to the stem, then the parallel midbody. */
export function halfBreadthAt(view: Pick<FigureView, "ship">, alongX: number, upZ = Number.NaN): number {
  const { stemX, halfBeam, keelZ, deckZ } = view.ship;
  // The entrance is fuller at the deck than at the keel: the bow flares out above the water.
  const height = Number.isNaN(upZ) ? 1 : Math.min(1, Math.max(0, (upZ - keelZ) / (deckZ - keelZ)));
  const entranceLength = 58 - 14 * height;
  const entranceX = stemX - entranceLength;
  if (alongX >= stemX) return 0;
  if (alongX > entranceX) return halfBeam * Math.pow(Math.max(0, 1 - ((alongX - entranceX) / entranceLength) ** 2), 0.62 - 0.18 * height);
  return halfBeam;
}

/** The figure's world for one set of facts: the same numbers on the server and in the browser. */
export function buildFigureView(facts: AnchorFigureFacts): FigureView {
  const spec = SHIP_SPECS.tanker;
  const length = facts.lengthMetres;
  const depth = facts.depthMetres;
  const draught = spec.draughtToLength * length;
  const freeboard = (spec.depthToLength - spec.draughtToLength) * length;
  // The hawse sits 9 m aft of the stem on a 228 m ship (sourceRef src/lib/console/vessel-profile.ts, HAWSE_AFT_OF_STEM_METRES).
  const stemX = 9 * (length / 228);
  const ship = { stemX, sternX: stemX - length, halfBeam: (spec.beamToLength * length) / 2, draught, freeboard, keelZ: depth - draught, deckZ: depth + freeboard, length };
  // The hawse opens in the sheer strake, which keeps the deck's breadth down its 2.2 m (anchor-figure-scene.ts).
  const hawseHalfBreadth = halfBreadthAt({ ship }, 0, ship.deckZ);
  const scale = DRAWN_SCALES.anchor;
  const anchor: AnchorDims = {
    shank: ANCHOR_LENGTH_METRES * scale,
    shankDepth: ANCHOR_LENGTH_METRES * SPEK_SHARE.shankDepth * scale,
    shankWidth: ANCHOR_LENGTH_METRES * SPEK_SHARE.shankDepth * 0.62 * scale,
    crownLength: ANCHOR_LENGTH_METRES * SPEK_SHARE.crown * scale,
    crownDepth: ANCHOR_LENGTH_METRES * SPEK_SHARE.shankDepth * 1.25 * scale,
    halfWidth: (ANCHOR_WIDTH_METRES / 2) * scale,
    fluke: ANCHOR_LENGTH_METRES * SPEK_SHARE.fluke * scale,
    flukeWidth: ANCHOR_WIDTH_METRES * 0.36 * scale,
    thickness: ANCHOR_LENGTH_METRES * SPEK_SHARE.pin * 1.6 * scale,
    pin: ANCHOR_LENGTH_METRES * SPEK_SHARE.pin * scale,
  };
  const chainDiameter = facts.chain.chainDiameterMm / 1000;
  const points: Point3[] = [...boxCorners(PLINTH, PLINTH_BOTTOM - FOOT_HEIGHT, 0), ...boxCorners(BLOCK, 0, depth + 2), [ship.stemX, 0, ship.deckZ + 16], [BLOCK.x, 0, ship.deckZ + 12]];
  const projection = fitProjection(points, VIEW_WIDTH, VIEW_HEIGHT, { pad: VIEW_PAD, azimuth: AZIMUTH, elevation: ELEVATION });
  // The most chain the figure pays out: the layback that puts the crown at CROWN_AFT_LIMIT (the shackle is a shank ahead).
  const mostLayback = -(CROWN_AFT_LIMIT + anchor.shank);
  return {
    projection,
    depth,
    chainY: ship.halfBeam + 1.6,
    hawse: [0, hawseHalfBreadth, depth + facts.chain.hawseAboveWaterMetres],
    ship,
    anchor,
    link: { length: STUD_LINK_LENGTH_TO_DIAMETER * chainDiameter * DRAWN_SCALES.chainLink, width: STUD_LINK_WIDTH_TO_DIAMETER * chainDiameter * DRAWN_SCALES.chainLink },
    cableRadius: CABLE_DRAWN_RADIUS,
    paidOutRange: [30, Math.round(paidOutForLayback(facts, mostLayback))],
    tourPaidOut: Math.round(paidOutForLayback(facts, -(BLOCK.x + BLOCK.w * CROWN_TOUR_SHARE + anchor.shank))),
  };
}

/** World to view-box point. */
export const atPoint = (view: FigureView, point: Point3): Flat => iso(point, view.projection);
