import { boxCorners, fitProjection, iso, type Flat, type Plan, type Point3, type Projection } from "@/components/iso/iso-kit";
import type { AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";
import { SHIP_SPECS } from "@/lib/ships/ship-specs";

// The anchor figure's world, in metres: x along the track (the ship heads +x), y across it (the viewer looks from +y),
// z up from the seabed. The block follows the ship, so the hawse stays at x = 0 and the seabed slides aft under it.
// Length and depth share one scale; only the anchor, its chain and the cable are drawn larger than life (DRAWN_SCALES).
// Plain numbers only: the server art and the live component both build from this.

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 292;
const VIEW_PAD = 12;
export const AZIMUTH = 62;
export const ELEVATION = 24;

/** The block of sea: its floor plan, the sediment under the seabed (z 0) and the plinth it stands on. */
export const BLOCK: Plan = { x: -372, y: -40, w: 420, d: 80, r: 0 };
export const SEDIMENT_BOTTOM = -11;
export const PLINTH: Plan = { x: BLOCK.x - 4, y: BLOCK.y - 4, w: BLOCK.w + 8, d: BLOCK.d + 8, r: 2 };
export const PLINTH_BOTTOM = -15;
export const FOOT_HEIGHT = 3;

/** How much larger than life the small things are drawn, so they read at the block's scale. */
export const DRAWN_SCALES = {
  /** The anchor, about 4 by 2.5 m (the police figure the replay's close-up uses: src/lib/seabed/scene-scales.ts). */
  anchor: 5,
  /** The chain's links: a stud link is about six chain diameters long (84 mm chain from the anchor model). */
  chainLink: 5,
} as const;
/** The cable's drawn radius (m): 2 m across, far thicker than life, as the replay's close-up draws it thicker. */
const CABLE_DRAWN_RADIUS = 1;

/** The police: the anchor about 4 m long and 2.5 m wide (sourceRef src/lib/seabed/scene-scales.ts, closeUpAnchorScale). */
const ANCHOR_LENGTH_METRES = 4;
const ANCHOR_WIDTH_METRES = 2.5;
// A common stud link is six chain diameters long and 3.6 wide (ISO 1704 proportions).
const STUD_LINK_LENGTH_TO_DIAMETER = 6;
const STUD_LINK_WIDTH_TO_DIAMETER = 3.6;

export type FigureView = {
  projection: Projection;
  depth: number;
  /**
   * The chain leaves the starboard hawse, swings out clear of the bow's flare within its first metres, and runs aft
   * just outside the hull's beam: the anchor, its furrow and the snag lie on this line.
   */
  chainY: number;
  hawse: Point3;
  ship: { stemX: number; sternX: number; halfBeam: number; draught: number; freeboard: number; keelZ: number; deckZ: number };
  anchor: { shank: number; shankHalf: number; crownLength: number; crownHalf: number; halfWidth: number; fluke: number; flukeWidth: number; thickness: number };
  link: { length: number; width: number };
  cableRadius: number;
};

/** Half the breadth of the hull at x (m): an elliptic entrance forward, a parallel midbody, a short run to the transom. */
export function halfBreadthAt(view: Pick<FigureView, "ship">, x: number): number {
  const { stemX, sternX, halfBeam } = view.ship;
  const entranceX = stemX - 54;
  if (x >= stemX) return 0;
  if (x > entranceX) return halfBeam * Math.sqrt(Math.max(0, 1 - ((x - entranceX) / (stemX - entranceX)) ** 2));
  const runX = sternX + 22;
  if (x < runX) return halfBeam * (0.78 + 0.22 * Math.sqrt(Math.max(0, 1 - ((runX - x) / 22) ** 2)));
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
  const ship = { stemX, sternX: stemX - length, halfBeam: (spec.beamToLength * length) / 2, draught, freeboard, keelZ: depth - draught, deckZ: depth + freeboard };
  const hawseHalfBreadth = halfBreadthAt({ ship }, 0);
  const anchorScale = DRAWN_SCALES.anchor;
  const linkScale = DRAWN_SCALES.chainLink;
  const chainDiameter = facts.chain.chainDiameterMm / 1000;
  const points: Point3[] = [
    ...boxCorners(PLINTH, PLINTH_BOTTOM - FOOT_HEIGHT, 0),
    ...boxCorners(BLOCK, 0, depth + 2),
    // The bridge roof and the funnel top, about 24 and 30 m above the water (ship-specs.ts, Eagle S photograph).
    [ship.sternX + 0.1 * length, 0, depth + 31],
    [ship.sternX + 0.19 * length, ship.halfBeam, depth + 25],
  ];
  const projection = fitProjection(points, VIEW_WIDTH, VIEW_HEIGHT, { pad: VIEW_PAD, azimuth: AZIMUTH, elevation: ELEVATION });
  return {
    projection,
    depth,
    chainY: ship.halfBeam + 1.2,
    hawse: [0, hawseHalfBreadth, depth + facts.chain.hawseAboveWaterMetres],
    ship,
    anchor: {
      shank: ANCHOR_LENGTH_METRES * anchorScale,
      shankHalf: 0.16 * anchorScale,
      crownLength: 0.7 * anchorScale,
      crownHalf: 0.22 * anchorScale,
      halfWidth: (ANCHOR_WIDTH_METRES / 2) * anchorScale,
      fluke: 2.3 * anchorScale,
      flukeWidth: 0.9 * anchorScale,
      thickness: 0.28 * anchorScale,
    },
    link: { length: STUD_LINK_LENGTH_TO_DIAMETER * chainDiameter * linkScale, width: STUD_LINK_WIDTH_TO_DIAMETER * chainDiameter * linkScale },
    cableRadius: CABLE_DRAWN_RADIUS,
  };
}

/** World to view-box point. */
export const atPoint = (view: FigureView, point: Point3): Flat => iso(point, view.projection);
