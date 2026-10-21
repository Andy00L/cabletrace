import {
  boxCorners,
  corners,
  cylinder,
  depthOf,
  extrude,
  insetPlan,
  iso,
  pathOf,
  ringSeam,
  segment,
  sideSeam,
  slabOf,
  type Flat,
  type Plan,
  type Plane,
  type SolidPaths,
} from "@/components/iso/iso-kit";
import { hullOf } from "@/components/iso/prism";
import { BLOCK, FOOT_HEIGHT, PLINTH, PLINTH_BOTTOM, SEDIMENT_BOTTOM, halfBreadthAt, type FigureView } from "@/components/landing/anchor-figure-view";

// Every static path of the anchor figure, computed once on the server from the figure's world
// (anchor-figure-view.ts): the plinth and the block of sea, the ship, the water's edges and the depth scale.
// The parts that move or change shape are built per frame in anchor-figure-frame.ts.

/** Floor points sorted far to near, for painting repeated parts back to front. */
const byDepth = (view: FigureView, points: Plane[]) => [...points].sort((first, second) => depthOf([first[0], first[1], 0], view.projection) - depthOf([second[0], second[1], 0], view.projection));

/** The hull's waterplane as a ring: stem to transom on the starboard side, back along port. */
export function hullRing(view: FigureView, fromX: number, toX: number, inset = 0): Plane[] {
  const steps = 40;
  const starboard: Plane[] = Array.from({ length: steps + 1 }, (_slot, index) => {
    const alongX = toX - ((toX - fromX) * index) / steps;
    return [alongX, Math.max(0, halfBreadthAt(view, alongX) - inset)];
  });
  const port = [...starboard].reverse().map(([alongX, acrossY]): Plane => [alongX, -acrossY]);
  return [...starboard, ...port].filter((point, index, all) => index === 0 || point[0] !== all[index - 1]?.[0] || point[1] !== all[index - 1]?.[1]);
}

export type ShipArt = {
  underwater: SolidPaths;
  topsides: SolidPaths;
  bootTop: string;
  forecastle: SolidPaths;
  windlass: SolidPaths[];
  deckChain: string;
  bitts: SolidPaths[];
  catwalk: string;
  manifold: SolidPaths;
  crane: { post: SolidPaths; jib: string };
  house: SolidPaths[];
  bridge: SolidPaths;
  windows: string;
  funnel: SolidPaths;
  funnelBand: string;
  mast: SolidPaths;
  lifeboat: SolidPaths;
  hawseRing: string;
};

function buildShip(view: FigureView): ShipArt {
  const { projection, depth, ship } = view;
  const { stemX, sternX, keelZ, deckZ, halfBeam, freeboard } = ship;
  const length = stemX - sternX;
  const ring = hullRing(view, sternX, stemX);
  const underwater = extrude(ring, keelZ, depth - keelZ, projection);
  const topsides = extrude(ring, depth, freeboard, projection);
  const forecastleFrom = stemX - 0.1 * length;
  const forecastle = extrude(hullRing(view, forecastleFrom, stemX - 0.4, 0.3), deckZ, 2.2, projection);
  const forecastleTop = deckZ + 2.2;
  // The windlass: one gypsy each side of the centreline, aft of the hawse pipes.
  const windlass = [-4.2, 4.2].map((side) => cylinder(stemX - 15, side, 1.6, forecastleTop, 1.8, projection, 20));
  // The starboard chain runs from its gypsy forward to the deck end of the hawse pipe.
  const deckChain = pathOf([iso([stemX - 15, 4.2, forecastleTop + 1.8], projection), iso([stemX - 10, view.hawse[1] - 1.2, forecastleTop + 0.4], projection), iso([0, view.hawse[1] - 0.8, forecastleTop], projection)]);
  const bitts = [
    [stemX - 6, -2.6],
    [stemX - 6, 2.6],
    [sternX + 4, -halfBeam * 0.6],
    [sternX + 4, halfBeam * 0.6],
  ].map(([alongX = 0, acrossY = 0]) => cylinder(alongX, acrossY, 0.7, alongX > forecastleFrom ? forecastleTop : deckZ, 1.1, projection, 14));
  const houseFront = sternX + 0.19 * length;
  const houseAft = houseFront - 0.15 * length;
  const catwalk = pathOf([iso([houseFront, 0, deckZ + 1.6], projection), iso([forecastleFrom, 0, deckZ + 1.6], projection)]);
  const manifold = slabOf({ x: sternX + 0.5 * length - 2, y: -halfBeam * 0.7, w: 4, d: halfBeam * 1.4, r: 0.4 }, deckZ, 1.4, projection, 3, 0.3);
  const craneX = sternX + 0.5 * length + 6;
  const crane = { post: cylinder(craneX, halfBeam * 0.55, 0.6, deckZ, 8, projection, 14), jib: pathOf([iso([craneX, halfBeam * 0.55, deckZ + 8], projection), iso([craneX - 13, halfBeam * 0.55 - 2, deckZ + 13], projection)]) };
  // Four accommodation tiers of 2.9 m (ship-specs.ts house.tiers), each a little shorter, then the bridge with its wings.
  const tierHeight = 2.9;
  const house = Array.from({ length: 4 }, (_slot, tier) => {
    const aft = houseAft + tier * 1.2;
    return slabOf({ x: aft, y: -halfBeam * 0.78, w: houseFront - aft, d: halfBeam * 1.56, r: 0.8 }, deckZ + tier * tierHeight, tierHeight, projection, 3, 0.4);
  });
  const bridgeZ = deckZ + 4 * tierHeight;
  const bridge = slabOf({ x: houseFront - 10, y: -halfBeam, w: 10, d: halfBeam * 2, r: 0.6 }, bridgeZ, tierHeight, projection, 3, 0.4);
  // The bridge windows: a rule along the front face just under the roof, edge to edge.
  const windows = pathOf([iso([houseFront, -halfBeam, bridgeZ + 1.9], projection), iso([houseFront, halfBeam, bridgeZ + 1.9], projection)]);
  const funnelPlan: Plan = { x: sternX + 0.08 * length - 2.4, y: -3.2, w: 4.8, d: 6.4, r: 1.2 };
  const funnelBase = deckZ + 4 * tierHeight;
  const funnel = slabOf(funnelPlan, funnelBase, 9.5, projection, 4, 0.4);
  const funnelBand = sideSeam(funnelPlan, funnelBase + 7.6, projection, 4);
  const mast = cylinder(houseFront - 5, 0, 0.35, bridgeZ + tierHeight, 6.5, projection, 10);
  const lifeboat = slabOf({ x: houseAft + 2, y: halfBeam * 0.8, w: 7, d: 2.4, r: 1.1 }, deckZ + 2 * tierHeight + 0.4, 1.6, projection, 4, 0.3);
  // The hawse pipe's mouth on the starboard bow, where the chain leaves the hull.
  const hawse = view.hawse;
  const hawseRing = pathOf(
    Array.from({ length: 16 }, (_slot, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return iso([hawse[0] + 1.1 * Math.cos(angle), hawse[1] + 0.2, hawse[2] + 0.8 * Math.sin(angle)], projection);
    }),
    true,
  );
  return { underwater, topsides, bootTop: ringSeam(ring, depth + 1.4, projection), forecastle, windlass, deckChain, bitts, catwalk, manifold, crane, house, bridge, windows, funnel, funnelBand, mast, lifeboat, hawseRing };
}

export type BlockArt = {
  feet: SolidPaths[];
  plinth: SolidPaths;
  plinthScrews: Flat[];
  sediment: SolidPaths;
  strata: string;
  /** The seabed face as one closed path, for the clip that keeps the sliding texture on it. */
  seabedClip: string;
  /** The water's box on screen: the silt stays inside it, never in the air past the block's ends. */
  waterClip: string;
  /** Ends of the seabed along x, for the fade that lets the sliding texture run out instead of stopping. */
  fadeFrom: Flat;
  fadeTo: Flat;
  waterBack: string;
  waterFront: string;
  surfaceEdges: string;
  surfaceHatch: string;
};

function buildBlock(view: FigureView): BlockArt {
  const { projection, depth } = view;
  const feet = byDepth(view, corners(PLINTH, 14)).map(([alongX, acrossY]) => cylinder(alongX, acrossY, 4.2, PLINTH_BOTTOM - FOOT_HEIGHT, FOOT_HEIGHT, projection, 20));
  const plinth = slabOf(PLINTH, PLINTH_BOTTOM, SEDIMENT_BOTTOM - PLINTH_BOTTOM, projection, 4, 0.8);
  const plinthScrews = corners(PLINTH, 2.2).map(([alongX, acrossY]) => iso([alongX, acrossY, SEDIMENT_BOTTOM], projection));
  const sediment = slabOf(BLOCK, SEDIMENT_BOTTOM, -SEDIMENT_BOTTOM, projection, 2, 0);
  const strata = [-3.2, -6.6].map((height) => sideSeam(BLOCK, height, projection, 2)).join("");
  const top = [
    [BLOCK.x, BLOCK.y],
    [BLOCK.x + BLOCK.w, BLOCK.y],
    [BLOCK.x + BLOCK.w, BLOCK.y + BLOCK.d],
    [BLOCK.x, BLOCK.y + BLOCK.d],
  ] as const;
  // The clip is the seabed face plus 12 m of air over its far edge, so stones and a cable there keep their tops; at the
  // block's ends and near edge it follows the face, so nothing on the seabed shows past the block.
  const lift = 12;
  const seabedClip = pathOf(
    [iso([top[0][0], top[0][1], lift], projection), iso([top[1][0], top[1][1], lift], projection), iso([top[1][0], top[1][1], 0], projection), iso([top[2][0], top[2][1], 0], projection), iso([top[3][0], top[3][1], 0], projection), iso([top[0][0], top[0][1], 0], projection)],
    true,
  );
  const waterClip = pathOf(hullOf(boxCorners(BLOCK, 0, depth).map((point) => iso(point, projection))), true);
  const x0 = BLOCK.x;
  const x1 = BLOCK.x + BLOCK.w;
  const y0 = BLOCK.y;
  const y1 = BLOCK.y + BLOCK.d;
  const rise = (x: number, y: number) => segment([x, y, 0], [x, y, depth], projection);
  const waterBack = [rise(x0, y0), rise(x1, y0), segment([x0, y0, depth], [x1, y0, depth], projection), segment([x0, y0, depth], [x0, y1, depth], projection)].join("");
  const waterFront = [rise(x0, y1), rise(x1, y1)].join("");
  const surfaceEdges = [segment([x0, y1, depth], [x1, y1, depth], projection), segment([x1, y0, depth], [x1, y1, depth], projection)].join("");
  // The surface as the engravings draw it: rules along the track, run from one edge of the block to the other.
  const hatch: string[] = [];
  for (let acrossY = y0 + 4; acrossY < y1 - 1; acrossY += 4) hatch.push(segment([x0, acrossY, depth], [x1, acrossY, depth], projection));
  return {
    feet,
    plinth,
    plinthScrews,
    sediment,
    strata,
    seabedClip,
    waterClip,
    fadeFrom: iso([x0, 0, 0], projection),
    fadeTo: iso([x1, 0, 0], projection),
    waterBack,
    waterFront,
    surfaceEdges,
    surfaceHatch: hatch.join(""),
  };
}

export type ScaleArt = { post: SolidPaths; foot: SolidPaths; ticks: { minor: string; major: string } };

/** The depth scale: a square post on the block's near corner, a tick every 5 m and a longer one every 10 m. */
function buildScale(view: FigureView): ScaleArt {
  const { projection, depth } = view;
  const postX = BLOCK.x + BLOCK.w + 3.5;
  const postY = BLOCK.y + BLOCK.d + 3.5;
  const post = slabOf({ x: postX - 1.2, y: postY - 1.2, w: 2.4, d: 2.4, r: 0.3 }, 0, depth + 4, projection, 2, 0.2);
  const foot = slabOf({ x: postX - 2.6, y: postY - 2.6, w: 5.2, d: 5.2, r: 0.6 }, 0, 1.2, projection, 3, 0.3);
  // Ticks on the post's near face (postY + 1.2), counted up from the seabed: each grows from the face's left edge, and
  // the tens run across the whole face to its right edge.
  const minor: string[] = [];
  const major: string[] = [];
  for (let height = 5; height < depth + 0.5; height += 5) {
    const isMajor = height % 10 === 0;
    (isMajor ? major : minor).push(segment([postX - 1.2, postY + 1.2, height], [postX - 1.2 + (isMajor ? 2.4 : 1.2), postY + 1.2, height], projection));
  }
  return { post, foot, ticks: { minor: minor.join(""), major: major.join("") } };
}

export type StaticArt = { block: BlockArt; ship: ShipArt; scale: ScaleArt; seabedTexture: { ripples: string; stones: SolidPaths[]; period: number } };

/** Ripples and stones repeating every period, over the block and one period more, so the slide wraps without a seam. */
function buildSeabedTexture(view: FigureView) {
  const { projection } = view;
  const period = 120;
  const ripples: string[] = [];
  const stones: SolidPaths[] = [];
  for (let copy = 0; copy < Math.ceil(BLOCK.w / period) + 1; copy += 1) {
    const offset = BLOCK.x + copy * period;
    for (let along = 3; along < period; along += 7.5) {
      const points: Flat[] = [];
      for (let acrossY = BLOCK.y - 2; acrossY <= BLOCK.y + BLOCK.d + 2; acrossY += 6) points.push(iso([offset + along + 1.6 * Math.sin(acrossY * 0.11 + along), acrossY, 0], projection));
      ripples.push(pathOf(points));
    }
    for (const [along, across, radius] of [
      [18, -22, 1.8],
      [47, 26, 1.2],
      [71, -6, 2.4],
      [96, 31, 1.5],
      [108, -31, 1.1],
    ] as const) {
      stones.push(slabOf(insetPlan({ x: offset + along - radius, y: across - radius, w: radius * 2, d: radius * 1.6, r: radius * 0.7 }, 0), 0, radius * 0.45, projection, 4, 0.2));
    }
  }
  return { ripples: ripples.join(""), stones, period };
}

/** Every static path, once per set of facts. */
export function buildStaticArt(view: FigureView): StaticArt {
  return { block: buildBlock(view), ship: buildShip(view), scale: buildScale(view), seabedTexture: buildSeabedTexture(view) };
}
