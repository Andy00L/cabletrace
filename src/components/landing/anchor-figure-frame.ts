import { depthOf, iso, pathOf, translateAlong, type Flat, type Point3, type SolidPaths } from "@/components/iso/iso-kit";
import { add3, mul3, prismOf, type Frame } from "@/components/iso/prism";
import { BLOCK, halfBreadthAt, type FigureView } from "@/components/landing/anchor-figure-view";
import {
  CABLE_SPACING_METRES,
  PART_PULL_METRES,
  describeCable,
  describeReadout,
  layCables,
  readCablePull,
  readChainAt,
  readRestingMoment,
  type AnchorFigureFacts,
  type AnchorPlace,
  type CableState,
  type ChainReading,
} from "@/lib/landing/anchor-figure-model";

// The parts of the anchor figure that move or change shape, built from the model's state each time it changes: the
// chain's links along the catenary, the anchor at its pitch, the furrow behind it, and each cable on the seabed. Pure
// path strings, so the server draws the resting frame with the same code the browser runs.

// How far below the hawse the chain has swung out to its run beside the hull (m).
const SWING_METRES = 16;

/** Points of the chain in the world: the anchor's shackle first, the hawse last. */
export function chainWorldPoints(view: FigureView, reading: ChainReading): Point3[] {
  const anchorX = reading.kind === "grounded" ? -reading.laybackMetres : 0;
  // Links lie on the seabed, so the chain's line runs half a link's width above it, rising to the hawse.
  const lift = view.link.width / 2;
  const height = view.hawse[2];
  // From the hawse's y to the run's over the first SWING_METRES below the hawse, eased, so the chain clears the flare.
  const swingFrom = view.hawse[1];
  return reading.points.map((point) => {
    const below = Math.min(1, Math.max(0, (height - point.upMetres) / SWING_METRES));
    const eased = below * below * (3 - 2 * below);
    return [anchorX + point.alongMetres, swingFrom + (view.chainY - swingFrom) * eased, point.upMetres + lift * (1 - point.upMetres / height)];
  });
}

function resampleByLength(points: readonly Point3[], spacing: number): { at: Point3; tangent: Point3 }[] {
  const out: { at: Point3; tangent: Point3 }[] = [];
  let carried = spacing / 2;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const leg: Point3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(leg[0], leg[1], leg[2]);
    if (length < 1e-6) continue;
    const tangent = mul3(leg, 1 / length);
    while (carried <= length) {
      out.push({ at: add3(from, mul3(tangent, carried)), tangent });
      carried += spacing;
    }
    carried -= length;
  }
  return out;
}

export type ChainArt = { behindHull: string; front: string; studs: string; aboveWater: string; aboveStuds: string };

/**
 * The chain as stud links, alternate links turned a quarter turn, each a closed loop with its stud across the middle.
 * Links inside the hull's beam above the keel are behind the hull; links above the water are drawn over the surface.
 */
export function buildChainArt(view: FigureView, reading: ChainReading): ChainArt {
  const { projection, link, ship, depth } = view;
  const links = resampleByLength(chainWorldPoints(view, reading), link.length * 0.78);
  const behind: string[] = [];
  const front: string[] = [];
  const studs: string[] = [];
  const above: string[] = [];
  const aboveStuds: string[] = [];
  const half = link.length / 2;
  const width = link.width / 2;
  links.forEach(({ at, tangent }, index) => {
    // Alternate links lie across the track (y) and in the chain's own vertical plane.
    const across: Point3 = index % 2 === 0 ? [0, 1, 0] : [-tangent[2], 0, tangent[0]];
    const loop: Flat[] = Array.from({ length: 14 }, (_slot, step) => {
      const angle = (step / 14) * Math.PI * 2;
      return iso(add3(at, add3(mul3(tangent, half * Math.cos(angle)), mul3(across, width * Math.sin(angle)))), projection);
    });
    const ring = pathOf(loop, true);
    const stud = pathOf([iso(add3(at, mul3(across, width * 0.92)), projection), iso(add3(at, mul3(across, -width * 0.92)), projection)]);
    const isAboveWater = at[2] > depth;
    const isBehindHull = !isAboveWater && at[2] > ship.keelZ - 1 && halfBreadthAt(view, at[0]) > at[1] - 0.3;
    if (isAboveWater) {
      above.push(ring);
      aboveStuds.push(stud);
    } else if (isBehindHull) behind.push(ring);
    else {
      front.push(ring);
      studs.push(stud);
    }
  });
  return { behindHull: behind.join(""), front: front.join(""), studs: studs.join(""), aboveWater: above.join(""), aboveStuds: aboveStuds.join("") };
}

export type AnchorArt = { parts: SolidPaths[]; shackle: string; flukeTip: Point3 };

// How far the crown sits down into the seabed while the anchor drags, as a share of its height.
const CROWN_SINK_SHARE = 0.35;
// How high the fluke tips ride above the seabed while the flukes plough (m): just in it.
const FLUKE_TIP_Z = 0.15;
// A stockless anchor's flukes open about 45 degrees from the shank.
const FLUKE_OPENING = Math.PI / 4;

/**
 * The anchor at its shackle, the chain's first point. Hanging, its shank follows the chain straight down; let down far
 * enough that the crown would pass through the seabed, it tips over until it lies on its crown with the flukes dug in.
 */
export function buildAnchorArt(view: FigureView, reading: ChainReading): AnchorArt {
  const { projection, anchor } = view;
  const first = chainWorldPoints(view, reading)[0] ?? [0, view.chainY, 0];
  const crownRestZ = anchor.crownHalf * (1 - CROWN_SINK_SHARE);
  const shackleZ = first[2];
  const pitch = Math.asin(Math.max(-0.2, Math.min(1, (shackleZ - crownRestZ) / anchor.shank)));
  const along: Point3 = [Math.cos(pitch), 0, Math.sin(pitch)];
  const up: Point3 = [-Math.sin(pitch), 0, Math.cos(pitch)];
  const across: Point3 = [0, 1, 0];
  const shackle: Point3 = [first[0], first[1], shackleZ];
  const crown = add3(shackle, mul3(along, -anchor.shank));
  // The flukes open from the shank, but their tips stop in the seabed's skin.
  const deepest = -Math.asin(Math.max(-1, Math.min(1, (crown[2] - FLUKE_TIP_Z) / anchor.fluke)));
  const flukeAngle = Math.max(pitch - FLUKE_OPENING, deepest);
  const flukeAlong: Point3 = [Math.cos(flukeAngle), 0, Math.sin(flukeAngle)];
  const flukeNormal: Point3 = [-Math.sin(flukeAngle), 0, Math.cos(flukeAngle)];
  const shank = prismOf({ o: crown, a: along, u: up, v: across } satisfies Frame, rectangle(-anchor.shankHalf, anchor.shankHalf, -anchor.shankHalf * 0.8, anchor.shankHalf * 0.8), 0, anchor.shank - 1, projection);
  const crownBox = prismOf({ o: crown, a: across, u: along, v: up }, rectangle(-anchor.crownLength * 0.6, anchor.crownLength, -anchor.crownHalf, anchor.crownHalf), -anchor.halfWidth * 0.62, anchor.halfWidth * 0.62, projection);
  const flukeOutline: Flat[] = [
    [0, -anchor.flukeWidth / 2],
    [anchor.fluke * 0.72, -anchor.flukeWidth * 0.42],
    [anchor.fluke, -anchor.flukeWidth * 0.08],
    [anchor.fluke, anchor.flukeWidth * 0.08],
    [anchor.fluke * 0.72, anchor.flukeWidth * 0.42],
    [0, anchor.flukeWidth / 2],
  ];
  const flukes = [-1, 1].map((side) => {
    const root = add3(crown, mul3(across, side * (anchor.halfWidth - anchor.flukeWidth / 2)));
    return { solid: prismOf({ o: root, a: flukeNormal, u: flukeAlong, v: across }, flukeOutline, -anchor.thickness / 2, anchor.thickness / 2, projection), centre: root };
  });
  // Painted far to near: the far fluke, the crown, the shank, the near fluke.
  const ordered = [
    { solid: crownBox, centre: crown },
    { solid: shank, centre: add3(crown, mul3(along, anchor.shank / 2)) },
    ...flukes,
  ].sort((first, second) => depthOf(first.centre, projection) - depthOf(second.centre, projection));
  const ring: Flat[] = Array.from({ length: 18 }, (_slot, step) => {
    const angle = (step / 18) * Math.PI * 2;
    return iso(add3(shackle, add3(mul3(along, anchor.shankHalf * (0.4 + 1.5 * Math.cos(angle))), mul3(up, anchor.shankHalf * 1.25 * Math.sin(angle)))), projection);
  });
  const flukeTip = add3(crown, mul3(flukeAlong, anchor.fluke));
  return { parts: ordered.map((entry) => entry.solid), shackle: pathOf(ring, true), flukeTip };
}

function rectangle(fromU: number, toU: number, fromV: number, toV: number): Flat[] {
  return [
    [fromU, fromV],
    [toU, fromV],
    [toU, toV],
    [fromU, toV],
  ];
}

export type FurrowRun = { fromWorld: number; toWorld: number };

/** The furrow: a trough the width of the anchor with a lip each side, from where the flukes went in to where they are. */
export function buildFurrowArt(view: FigureView, runs: readonly FurrowRun[], travelledMetres: number): { trough: string; lips: string } {
  const { projection, anchor } = view;
  const inner = anchor.halfWidth * 0.8;
  const outer = anchor.halfWidth + 1.1;
  const troughs: string[] = [];
  const lips: string[] = [];
  for (const run of runs) {
    const fromX = Math.max(BLOCK.x - 6, run.fromWorld - travelledMetres);
    const toX = Math.min(BLOCK.x + BLOCK.w, run.toWorld - travelledMetres);
    if (toX - fromX < 0.5) continue;
    const runY = view.chainY;
    troughs.push(pathOf([iso([fromX, runY - inner, 0], projection), iso([toX, runY - inner, 0], projection), iso([toX, runY + inner, 0], projection), iso([fromX, runY + inner, 0], projection)], true));
    for (const side of [-1, 1]) lips.push(pathOf([iso([fromX, runY + side * outer, 0], projection), iso([toX, runY + side * outer, 0], projection)]));
  }
  return { trough: troughs.join(""), lips: lips.join("") };
}

export type CableArt = { body: string; shade: string; edges: string; armour: string; frayed: string; sections: string };

const CABLE_STEPS = 48;

/** The cable's centreline: straight across the block, bowed forward to the flukes while snagged, parted in two after. */
function cableCentrelines(view: FigureView, cable: CableState, travelledMetres: number, flukeX: number): Point3[][] {
  const radius = view.cableRadius;
  const lyingX = cable.worldMetres - travelledMetres;
  // A parted cable springs back part of the way its ends were pulled (illustrated), then lies where it fell.
  const sinceParted = cable.phase.kind === "parted" ? Math.max(0, travelledMetres - cable.phase.atTravelledMetres - PART_PULL_METRES) : 0;
  const pull = readCablePull(cable, travelledMetres) * (cable.phase.kind === "parted" ? 0.55 + 0.45 * Math.exp(-sinceParted / 6) : 1);
  const apexY = view.chainY;
  const y0 = BLOCK.y;
  const y1 = BLOCK.y + BLOCK.d;
  const bowAt = (acrossY: number) => {
    const reach = acrossY > apexY ? y1 - apexY : apexY - y0;
    const share = Math.min(1, Math.abs(acrossY - apexY) / reach);
    // A taut cable pulled by one point: nearly straight legs, rounded where the flukes hold it.
    return pull * Math.pow(1 - Math.sqrt(share * share + 0.0016) + 0.04, 1.15);
  };
  const lineFrom = (fromY: number, toY: number) => Array.from({ length: CABLE_STEPS + 1 }, (_slot, index): Point3 => {
    const acrossY = fromY + ((toY - fromY) * index) / CABLE_STEPS;
    return [lyingX + bowAt(acrossY), acrossY, radius];
  });
  if (cable.phase.kind === "snagged") {
    // The bight follows the flukes exactly while the anchor holds it.
    const offset = flukeX - (lyingX + bowAt(apexY));
    return [lineFrom(y0, y1).map(([alongX, acrossY, upZ]) => [alongX + offset * Math.max(0, 1 - Math.abs(acrossY - apexY) / 30), acrossY, upZ])];
  }
  if (cable.phase.kind === "parted") {
    const gap = 1.6 + Math.min(2.6, sinceParted * 0.25);
    return [lineFrom(y0, apexY - gap), lineFrom(apexY + gap, y1)];
  }
  return [lineFrom(y0, y1)];
}

/**
 * One cable as a tube on the seabed: a paper body between two edges, a shade band on its lower side, armour wires
 * across it every metre, a cut section where it leaves the block's near face, and frayed armour where it parted.
 */
export function buildCableArt(view: FigureView, cable: CableState, travelledMetres: number, flukeX: number): CableArt {
  const { projection } = view;
  const radiusPx = view.cableRadius * Math.sqrt(1.6) * projection.scale;
  const out: CableArt = { body: "", shade: "", edges: "", armour: "", frayed: "", sections: "" };
  const lines = cableCentrelines(view, cable, travelledMetres, flukeX);
  for (const [lineIndex, centreline] of lines.entries()) {
    const flat = centreline.map((point) => iso(point, projection));
    const normals = flat.map((point, index) => {
      const previous = flat[Math.max(0, index - 1)] ?? point;
      const next = flat[Math.min(flat.length - 1, index + 1)] ?? point;
      const dx = next[0] - previous[0];
      const dy = next[1] - previous[1];
      const length = Math.hypot(dx, dy) || 1;
      // The normal that points down the screen, so `+` is the cable's lower, shaded side.
      const normal: Flat = [-dy / length, dx / length];
      return normal[1] < 0 ? ([-normal[0], -normal[1]] as Flat) : normal;
    });
    const offset = (amount: number) => flat.map((point, index): Flat => [point[0] + (normals[index]?.[0] ?? 0) * amount, point[1] + (normals[index]?.[1] ?? 0) * amount]);
    const upper = offset(-radiusPx);
    const lower = offset(radiusPx);
    out.body += pathOf([...upper, ...[...lower].reverse()], true);
    out.shade += pathOf([...offset(radiusPx * 0.25), ...[...lower].reverse()], true);
    out.edges += pathOf(upper) + pathOf(lower);
    // Armour wires: short slanted strokes from edge to edge, one per metre of cable.
    for (let index = 1; index < flat.length - 1; index += 1) {
      const top = upper[index];
      const bottom = lower[index + 1] ?? lower[index];
      if (top && bottom) out.armour += pathOf([top, bottom]);
    }
    const isPartedEnd = (end: "start" | "end") => cable.phase.kind === "parted" && ((lineIndex === 0 && end === "end") || (lineIndex === 1 && end === "start"));
    for (const end of ["start", "end"] as const) {
      const point = end === "start" ? centreline[0] : centreline[centreline.length - 1];
      if (!point) continue;
      const isNearFace = Math.abs(point[1] - (BLOCK.y + BLOCK.d)) < 0.01;
      if (isNearFace) {
        // The cut section on the near face: sheath, armour and core, concentric.
        out.sections += [1, 0.72, 0.38].map((share) => ellipseOnFace(view, point, view.cableRadius * share)).join("");
      }
      if (isPartedEnd(end)) {
        // Frayed armour: wires splayed out of the parted end.
        const direction = end === "end" ? 1 : -1;
        for (let wire = -2; wire <= 2; wire += 1) {
          const root: Point3 = [point[0] + wire * 0.32, point[1], point[2] + wire * 0.18];
          const tip: Point3 = [point[0] + wire * 0.9, point[1] + direction * (1.4 + Math.abs(wire) * 0.25), point[2] + 0.5 + wire * 0.35];
          out.frayed += pathOf([iso(root, projection), iso(tip, projection)]);
        }
      }
    }
  }
  return out;
}

function ellipseOnFace(view: FigureView, centre: Point3, radius: number): string {
  return pathOf(
    Array.from({ length: 20 }, (_slot, step) => {
      const angle = (step / 20) * Math.PI * 2;
      return iso([centre[0] + radius * Math.cos(angle), centre[1], centre[2] + radius * Math.sin(angle)], view.projection);
    }),
    true,
  );
}

/** The slide of the seabed texture under the block: aft by the distance travelled, wrapped to one period. */
export function slideTransform(view: FigureView, travelledMetres: number, period: number): string {
  const wrapped = ((travelledMetres % period) + period) % period;
  return translateAlong(view.projection, [-wrapped, 0, 0]);
}

/** Moves art drawn at the hawse's x to the anchor's x (the fallback plume rides with the anchor). */
export function alongTransform(view: FigureView, metres: number): string {
  return translateAlong(view.projection, [metres, 0, 0]);
}

/** The anchor's place for the cables: the flukes' tips, which is where a cable is caught. */
export function placeFlukes(anchorArt: AnchorArt, reading: ChainReading): AnchorPlace {
  return { aheadOfHawseMetres: anchorArt.flukeTip[0], isOnSeabed: reading.kind === "grounded" && anchorArt.flukeTip[2] < FLUKE_TIP_Z + 0.5 };
}

/** The cable slots the figure draws: the spacing keeps at most two in or near the block. */
export const CABLE_SLOTS = 2;

/** The cables lying in or near the block at a distance travelled, keeping the phase of those already met. */
export function keepCablesNear(cables: readonly CableState[], travelled: number): CableState[] {
  const fromWorld = travelled + BLOCK.x - CABLE_SPACING_METRES * 0.25;
  const toWorld = travelled + BLOCK.x + BLOCK.w + CABLE_SPACING_METRES * 0.4;
  const kept = cables.filter((cable) => cable.worldMetres >= fromWorld && cable.worldMetres <= toWorld);
  const fresh = layCables(fromWorld, toWorld).filter((cable) => !kept.some((existing) => existing.worldMetres === cable.worldMetres));
  return [...kept, ...fresh].sort((first, second) => first.worldMetres - second.worldMetres).slice(0, CABLE_SLOTS);
}

export const CHAIN_POINT_COUNT = 72;
export const EMPTY_CABLE: CableArt = { body: "", shade: "", edges: "", armour: "", frayed: "", sections: "" };

/**
 * The resting frame (readRestingMoment in the model): what the server draws, what reduced motion keeps, and where the
 * live loop starts from. The same function on both sides, so hydration finds the same paths.
 */
export function buildRestingFrame(facts: AnchorFigureFacts, view: FigureView) {
  const moment = readRestingMoment(facts);
  const reading = readChainAt(facts, moment.paidOutMetres, CHAIN_POINT_COUNT);
  const anchor = buildAnchorArt(view, reading);
  const chain = buildChainArt(view, reading);
  // The furrow runs from beyond the block's aft end to the flukes: the anchor has been dragging all along.
  const runs: FurrowRun[] = [{ fromWorld: moment.travelledMetres + BLOCK.x - 40, toWorld: moment.travelledMetres + anchor.flukeTip[0] }];
  const furrow = buildFurrowArt(view, runs, moment.travelledMetres);
  const cables = keepCablesNear(moment.cables, moment.travelledMetres);
  const cableArts = Array.from({ length: CABLE_SLOTS }, (_slot, index) => {
    const cable = cables[index];
    return cable ? buildCableArt(view, cable, moment.travelledMetres, anchor.flukeTip[0]) : EMPTY_CABLE;
  });
  const readout = describeReadout(facts, reading, describeCable(cables, placeFlukes(anchor, reading), moment.travelledMetres));
  return { moment, reading, anchor, chain, runs, furrow, cables, cableArts, readout };
}
