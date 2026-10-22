import { iso, pathOf, translateAlong, type Flat, type Point3 } from "@/components/iso/iso-kit";
import { add3, circleOf, dot3, dotsOf, frameOf, mul3, unit3, viewOf, type Frame } from "@/components/iso/lathe.mjs";
import { ballPart, discPart, markupPart, prismPart, tubeParts, turnedPart, type Part } from "@/components/landing/anchor-figure-parts";
import { BLOCK, halfBreadthAt, type FigureView } from "@/components/landing/anchor-figure-view";
import {
  CABLE_SPACING_METRES,
  PART_PULL_METRES,
  describeCable,
  describeReadout,
  layCables,
  readCablePull,
  readChainAt,
  readStageMoment,
  type AnchorFigureFacts,
  type AnchorPlace,
  type CableState,
  type FigureStage,
  type ChainReading,
} from "@/lib/landing/anchor-figure-model";

// The parts of the anchor figure that move or change shape, rebuilt whenever the model's state changes: the chain's
// stud links along the catenary, the anchor at its pitch with one fluke in the clay, the furrow and its spoil, and each
// cable on the seabed with its armour and, once parted, its layers stepped back at the torn ends. Pure strings and
// shapes, so the audit script and the browser run the same code.

const AXIS_Y: Point3 = [0, 1, 0];
// How far below the hawse the chain has swung out to its run beside the hull (m).
const SWING_METRES = 16;
// The furrow's trench: its depth below the seabed and its berms of spoil (m, drawn with the anchor's scale).
const FURROW_DEPTH = 1.8;
const BERM_HEIGHT = 1.1;
// A stockless anchor's flukes open about 40 degrees from the shank (Spek and Hall types: 35 to 45 degrees).
const FLUKE_OPENING = (40 * Math.PI) / 180;
// The spoil mound's centre ahead of the fluke tips (m): its 5.2 m foot starts just ahead of them.
const MOUND_AHEAD_METRES = 7;
// While it drags, the anchor rolls a little about its shank, so the near fluke bites deeper than the far one.
const DRAG_ROLL = (30 * Math.PI) / 180;

/** Points of the chain in the world: the anchor's shackle first, the hawse last. */
function chainWorldPoints(view: FigureView, reading: ChainReading): Point3[] {
  const anchorX = reading.kind === "grounded" ? -reading.laybackMetres : 0;
  // Links lie on the seabed, so the chain's line runs half a link's width above it, rising to the hawse.
  const lift = view.link.width / 2;
  const height = view.hawse[2];
  const swingFrom = view.hawse[1];
  return reading.points.map((point) => {
    const below = Math.min(1, Math.max(0, (height - point.upMetres) / SWING_METRES));
    const eased = below * below * (3 - 2 * below);
    return [anchorX + point.alongMetres, swingFrom + (view.chainY - swingFrom) * eased, point.upMetres + lift * (1 - point.upMetres / height)];
  });
}

function resampleByLength(points: readonly Point3[], spacing: number, skip: number): { at: Point3; tangent: Point3 }[] {
  const out: { at: Point3; tangent: Point3 }[] = [];
  let carried = skip;
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

type ChainArt = { behindHull: string; front: string; aboveWater: string };

/**
 * The chain as stud links (6 by 3.6 chain diameters, ISO 1704), alternate links turned a quarter turn, each a closed
 * loop filled with paper with its stud across the middle. Links inside the hull's beam are behind the hull; links
 * above the water are drawn over the surface. The first links are the anchor's own (the swivel and end link).
 */
export function buildChainArt(view: FigureView, reading: ChainReading): ChainArt {
  const { projection, link, ship, depth } = view;
  // The first link sits just past the anchor's swivel (buildAnchorArt: the shackle's eye, bow and swivel span about
  // 4.4 pins ahead of the shackle point).
  const links = resampleByLength(chainWorldPoints(view, reading), link.length * 0.8, view.anchor.pin * 4.4 + link.length * 0.5);
  const groups: Record<keyof ChainArt, string[]> = { behindHull: [], front: [], aboveWater: [] };
  const half = link.length / 2;
  const width = link.width / 2;
  links.forEach(({ at, tangent }, index) => {
    // The end link, next to the swivel, is a common link a size larger, without a stud (ISO 1704).
    const isEndLink = index === 0;
    const grow = isEndLink ? 1.15 : 1;
    const across: Point3 = index % 2 === 0 ? AXIS_Y : unit3([-tangent[2], 0, tangent[0]]);
    const loop: Flat[] = Array.from({ length: 16 }, (_slot, step) => {
      const angle = (step / 16) * Math.PI * 2;
      // A link's sides run straight between its round ends: a superellipse rather than an ellipse.
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const along = grow * half * Math.sign(cosine) * Math.pow(Math.abs(cosine), 0.7);
      const side = grow * width * Math.sign(sine) * Math.pow(Math.abs(sine), 0.85);
      return iso(add3(at, add3(mul3(tangent, along), mul3(across, side))), projection);
    });
    const inner: Flat[] = loop.map(([screenX, screenY]) => {
      const [centreX, centreY] = iso(at, projection);
      return [centreX + (screenX - centreX) * 0.62, centreY + (screenY - centreY) * 0.5];
    });
    const stud = pathOf([iso(add3(at, mul3(across, width * 0.5)), projection), iso(add3(at, mul3(across, -width * 0.5)), projection)]);
    const isAboveWater = at[2] > depth;
    const isBehindHull = !isAboveWater && at[2] > ship.keelZ - 1 && halfBreadthAt(view, at[0], at[2]) > at[1] - 0.3;
    const markup = `<path class="af-link" d="${pathOf(loop, true)}"/><path class="af-link-eye" d="${pathOf(inner, true)}"/>${isEndLink ? "" : `<path class="af-stud" d="${stud}"/>`}`;
    groups[isAboveWater ? "aboveWater" : isBehindHull ? "behindHull" : "front"].push(markup);
  });
  return { behindHull: groups.behindHull.join(""), front: groups.front.join(""), aboveWater: groups.aboveWater.join("") };
}

/**
 * The anchor's parts; the near fluke's tip (buried while it drags); whether a fluke is in the clay; and the hook, where
 * a cable is caught: just ahead of the foremost point where a fluke enters the seabed (the far fluke's tip if none does).
 */
export type AnchorArt = { parts: Part[]; flukeTip: Point3; isDug: boolean; hook: Point3 };

/** Clips a convex polygon to the half-plane where `height(point) >= floor` (Sutherland-Hodgman, one edge). */
function clipAbove(polygon: Flat[], height: (point: Flat) => number, floor: number): Flat[] {
  const out: Flat[] = [];
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length] ?? current;
    const isInside = height(current) >= floor;
    const wasInside = height(previous) >= floor;
    if (isInside !== wasInside) {
      const share = (floor - height(previous)) / (height(current) - height(previous));
      out.push([previous[0] + (current[0] - previous[0]) * share, previous[1] + (current[1] - previous[1]) * share]);
    }
    if (isInside) out.push(current);
  });
  return out;
}

/**
 * The anchor at its shackle, the chain's first point, as a Spek stockless anchor: the shank with its eye and a casting
 * seam, the crown with the pivot pin through it and its two stops, two flukes with their tripping palms, and the
 * D-shackle with its bolt, swivel and end link. Hanging, its shank follows the chain; let down far enough that the
 * crown would pass through the seabed, it tips over and drags rolled onto its near side, resting on the near pin head,
 * the near fluke dug into the clay and the far one half in (each fluke is cut off where it enters the seabed, so the
 * rest reads as buried).
 */
export function buildAnchorArt(view: FigureView, reading: ChainReading): AnchorArt {
  const { projection, anchor } = view;
  const first = chainWorldPoints(view, reading)[0] ?? [0, view.chainY, 0];
  const floor = 0;
  // Dragged and rolled, the anchor rests on its near pin head: the crown sits that head's drop above the seabed.
  const crownRestZ = (anchor.halfWidth + anchor.pin * 0.85) * Math.sin(DRAG_ROLL) + anchor.pin * 0.9 * Math.cos(DRAG_ROLL) + 0.3;
  const shankHalf = anchor.shankDepth / 2;
  const shankSide = anchor.shankWidth / 2;
  // The eye clears the seabed where the chain's first link lies on it.
  const shackleZ = Math.max(first[2], shankHalf * 0.8 + 0.05);
  const pitch = Math.asin(Math.max(-0.2, Math.min(1, (shackleZ - crownRestZ) / anchor.shank)));
  const isLying = pitch < 0.35;
  const roll = isLying ? DRAG_ROLL * Math.min(1, 1 - pitch / 0.35) : 0;
  const along: Point3 = [Math.cos(pitch), 0, Math.sin(pitch)];
  const upFlat: Point3 = [-Math.sin(pitch), 0, Math.cos(pitch)];
  // Rolled toward the viewer: the near fluke's root (across +y) drops, the far one rises.
  const up = add3(mul3(upFlat, Math.cos(roll)), mul3(AXIS_Y, Math.sin(roll)));
  const across = add3(mul3(AXIS_Y, Math.cos(roll)), mul3(upFlat, -Math.sin(roll)));
  const shackle: Point3 = [first[0], first[1], shackleZ];
  const crown = add3(shackle, mul3(along, -anchor.shank));
  const parts: Part[] = [];
  const look = { tone: "hi" as const, lit: true };
  // The shank: a chamfered bar from the crown's nose to the eye, narrowing toward the eye; a casting seam along its top.
  const chamfered = (halfU: number, halfV: number, cut: number): Flat[] => [
    [-halfU + cut, -halfV],
    [halfU - cut, -halfV],
    [halfU, -halfV + cut],
    [halfU, halfV - cut],
    [halfU - cut, halfV],
    [-halfU + cut, halfV],
    [-halfU, halfV - cut],
    [-halfU, -halfV + cut],
  ];
  const shankFrame: Frame = { o: crown, a: along, u: up, v: across };
  // The lower shank in three lengths, so a cable caught under it can be painted between them.
  const lowerFrom = anchor.crownLength * 0.78;
  const lowerTo = anchor.shank * 0.55;
  for (let index = 0; index < 3; index += 1) {
    const from = lowerFrom + ((lowerTo - lowerFrom) * index) / 3;
    const to = lowerFrom + ((lowerTo - lowerFrom) * (index + 1)) / 3;
    // The casting seam along the top, end face to end face of each length, drawn inside it while that face is seen.
    const isSeamSeen = dot3(up, viewOf(projection)) > 0;
    const seam = pathOf([iso(add3(crown, add3(mul3(along, from), mul3(up, shankHalf))), projection), iso(add3(crown, add3(mul3(along, to), mul3(up, shankHalf))), projection)]);
    parts.push(prismPart(`anchor.shank.lower#${index}`, shankFrame, chamfered(shankHalf, shankSide, shankSide * 0.35), from, to, projection, { ...look, inner: isSeamSeen ? `<path class="iso-line" data-tone="mid" d="${seam}"/>` : "" }));
  }
  parts.push(prismPart("anchor.shank.upper", shankFrame, chamfered(shankHalf * 0.78, shankSide * 0.8, shankSide * 0.3), anchor.shank * 0.55, anchor.shank - anchor.pin * 2.4, projection, look));
  // The eye at the head of the shank, its centre a pin and a fifth behind the shackle point, the bolt through it.
  const eyeCentre = add3(shackle, mul3(along, -anchor.pin * 1.2));
  const eyeFrame: Frame = { o: eyeCentre, a: across, u: along, v: up };
  const eyeOutline: Flat[] = Array.from({ length: 13 }, (_slot, step) => {
    const angle = -Math.PI / 2 + (step / 12) * Math.PI;
    return [anchor.pin * 1.4 * Math.cos(angle), shankHalf * 0.78 * Math.sin(angle)];
  });
  eyeOutline.push([-anchor.pin * 1.2, shankHalf * 0.78], [-anchor.pin * 1.2, -shankHalf * 0.78]);
  parts.push(prismPart("anchor.shank.eye", eyeFrame, eyeOutline, -shankSide * 0.6, shankSide * 0.6, projection, look));
  // The crown: the head the flukes turn in, with the pivot pin through it and a stop each side.
  const crownFrame: Frame = { o: crown, a: across, u: along, v: up };
  const crownProfile: Flat[] = [
    [-anchor.crownLength * 0.35, -anchor.crownDepth * 0.42],
    [anchor.crownLength * 0.62, -anchor.crownDepth * 0.42],
    [anchor.crownLength * 0.78, -anchor.crownDepth * 0.15],
    [anchor.crownLength * 0.62, anchor.crownDepth * 0.42],
    [-anchor.crownLength * 0.35, anchor.crownDepth * 0.42],
    [-anchor.crownLength * 0.5, 0],
  ];
  const crownHalf = anchor.halfWidth - anchor.flukeWidth;
  parts.push(prismPart("anchor.crown", crownFrame, crownProfile, -crownHalf, crownHalf, projection, look));
  const pinFrame = frameOf(add3(crown, mul3(along, anchor.crownLength * 0.12)), across, along, up);
  for (const side of [-1, 1]) {
    // The pin runs through the crown and both fluke roots; only its ends show, outside each fluke, under a head.
    const pinOut = (share: number) => side * (anchor.halfWidth + anchor.pin * share);
    parts.push(discPart(`anchor.pin#${side}`, pinFrame, Math.min(pinOut(0), pinOut(0.35)), Math.max(pinOut(0), pinOut(0.35)), anchor.pin * 0.55, projection, look));
    parts.push(discPart(`anchor.pin.head#${side}`, pinFrame, Math.min(pinOut(0.35), pinOut(0.85)), Math.max(pinOut(0.35), pinOut(0.85)), anchor.pin * 0.9, projection, look));
    const stopFrame: Frame = { o: add3(crown, mul3(across, side * crownHalf * 0.55)), a: across, u: along, v: up };
    parts.push(prismPart(`anchor.stop#${side}`, stopFrame, [[anchor.crownLength * 0.05, anchor.crownDepth * 0.42], [anchor.crownLength * 0.45, anchor.crownDepth * 0.42], [anchor.crownLength * 0.35, anchor.crownDepth * 0.62], [anchor.crownLength * 0.1, anchor.crownDepth * 0.62]], -anchor.pin * 0.7, anchor.pin * 0.7, projection, look));
  }
  // The flukes open from the crown toward the shank, each a tapering plate with a palm at its root.
  const flukeAlong = add3(mul3(along, Math.cos(FLUKE_OPENING)), mul3(up, -Math.sin(FLUKE_OPENING)));
  const flukeNormal = add3(mul3(along, Math.sin(FLUKE_OPENING)), mul3(up, Math.cos(FLUKE_OPENING)));
  const flukeOutline: Flat[] = [
    [0, -anchor.flukeWidth / 2],
    [anchor.fluke * 0.62, -anchor.flukeWidth * 0.5],
    [anchor.fluke * 0.92, -anchor.flukeWidth * 0.2],
    [anchor.fluke, 0],
    [anchor.fluke * 0.92, anchor.flukeWidth * 0.2],
    [anchor.fluke * 0.62, anchor.flukeWidth * 0.5],
    [0, anchor.flukeWidth / 2],
  ];
  let flukeTip: Point3 = add3(crown, mul3(flukeAlong, anchor.fluke));
  let isDug = false;
  let hook: Point3 | null = null;
  for (const side of [-1, 1]) {
    const root = add3(crown, mul3(across, side * (anchor.halfWidth - anchor.flukeWidth / 2)));
    const height = ([alongFluke, sideways]: Flat) => root[2] + alongFluke * flukeAlong[2] + sideways * across[2];
    const visible = clipAbove(flukeOutline, height, floor);
    if (flukeOutline.some((point) => height(point) < floor)) {
      isDug = true;
      // Where this fluke enters the clay: the clipped outline's points on the seabed, in the world.
      const entry = visible.filter((point) => Math.abs(height(point) - floor) < 1e-6).map(([alongFluke, sideways]) => add3(root, add3(mul3(flukeAlong, alongFluke), mul3(across, sideways))));
      const foremost = entry.reduce<Point3 | null>((best, point) => (best && best[0] >= point[0] ? best : point), null);
      if (foremost && (!hook || foremost[0] > hook[0])) hook = foremost;
    }
    if (visible.length >= 3) {
      const frame: Frame = { o: root, a: flukeNormal, u: flukeAlong, v: across };
      const rib = pathOf([iso(root, projection), iso(add3(root, mul3(flukeAlong, anchor.fluke * 0.85)), projection)]);
      parts.push(prismPart(`anchor.fluke#${side}`, frame, visible, -anchor.thickness / 2, anchor.thickness / 2, projection, { ...look, inner: `<path class="iso-line" data-tone="mid" d="${rib}"/>` }));
    }
    // The tripping palm: a plate standing up from the fluke's root, which tips the flukes down when the anchor drags.
    const palmFrame: Frame = { o: root, a: across, u: along, v: up };
    parts.push(prismPart(`anchor.palm#${side}`, palmFrame, [[-anchor.crownLength * 0.3, anchor.crownDepth * 0.35], [anchor.crownLength * 0.2, anchor.crownDepth * 0.35], [-anchor.crownLength * 0.1, anchor.crownDepth * 0.95]], -anchor.flukeWidth * 0.28, anchor.flukeWidth * 0.28, projection, look));
    if (side === 1) flukeTip = add3(root, mul3(flukeAlong, anchor.fluke));
  }
  // The D-shackle round the eye: its bow a tube ending at the bolt, the bolt across the eye with a head and a nut;
  // then the swivel and the end link.
  const bowRadius = shankSide * 1.4;
  const bowCentre = eyeCentre;
  const boltRadius = anchor.pin * 0.32;
  const bowEnd = Math.acos(Math.min(1, (boltRadius + anchor.pin * 0.5) / (bowRadius * 1.3)));
  const bow: Point3[] = Array.from({ length: 13 }, (_slot, step) => {
    const angle = -bowEnd + (step / 12) * bowEnd * 2;
    return add3(bowCentre, add3(mul3(across, bowRadius * Math.sin(angle)), mul3(along, bowRadius * 1.3 * Math.cos(angle))));
  });
  // In short chunks, so the bow passes behind the eye on the far side and in front of it on the near one.
  parts.push(...tubeParts("anchor.shackle.bow", bow, anchor.pin * 0.5, projection, { tone: "hi", maxLength: 0.6 }));
  const boltFrame = frameOf(bowCentre, across, along, up);
  for (const side of [-1, 1]) {
    const boltAt = (reach: number) => side * reach;
    parts.push(discPart(`anchor.shackle.bolt#${side}`, boltFrame, Math.min(boltAt(shankSide * 0.6), boltAt(bowRadius + anchor.pin * 0.4)), Math.max(boltAt(shankSide * 0.6), boltAt(bowRadius + anchor.pin * 0.4)), boltRadius, projection, look));
    const capName = side > 0 ? "anchor.shackle.nut" : "anchor.shackle.head";
    parts.push(discPart(capName, boltFrame, Math.min(boltAt(bowRadius + anchor.pin * 0.4), boltAt(bowRadius + anchor.pin * 0.9)), Math.max(boltAt(bowRadius + anchor.pin * 0.4), boltAt(bowRadius + anchor.pin * 0.9)), anchor.pin * (side > 0 ? 0.55 : 0.6), projection, look));
  }
  const swivelFrame = frameOf(add3(bowCentre, mul3(along, bowRadius * 1.3 + anchor.pin * 0.3)), along, up, across);
  parts.push(turnedPart("anchor.swivel", swivelFrame, [[0, 0.3 * anchor.pin], [0.2 * anchor.pin, 0.8 * anchor.pin], [1.4 * anchor.pin, 0.95 * anchor.pin, 1], [2.6 * anchor.pin, 0.8 * anchor.pin], [3.0 * anchor.pin, 0.4 * anchor.pin]], projection, look));
  const farTip = add3(crown, add3(mul3(across, -(anchor.halfWidth - anchor.flukeWidth / 2)), mul3(flukeAlong, anchor.fluke)));
  const caught = hook ?? farTip;
  return { parts, flukeTip, isDug, hook: [caught[0] + view.cableRadius, caught[1], 0] };
}

export type FurrowRun = { fromWorld: number; toWorld: number };

/**
 * The furrow: a trench the anchor's width with its far wall and floor showing, berms of spoil along both lips, and,
 * while the flukes plough, a mound of spoil pushed up ahead of them with clods thrown off it.
 */
export function buildFurrowArt(view: FigureView, runs: readonly FurrowRun[], travelledMetres: number, ploughAt: Point3 | null): { back: string; front: string; spoilParts: Part[] } {
  const { projection, anchor } = view;
  const inner = anchor.halfWidth + 0.8;
  const berm = 2.6;
  const back: string[] = [];
  const front: string[] = [];
  const spoilParts: Part[] = [];
  const runY = view.chainY;
  for (const run of runs) {
    const fromX = Math.max(BLOCK.x - 4, run.fromWorld - travelledMetres);
    const toX = Math.min(BLOCK.x + BLOCK.w, run.toWorld - travelledMetres);
    if (toX - fromX < 0.5) continue;
    const point = (alongX: number, acrossY: number, height: number) => iso([alongX, acrossY, height], projection);
    const floor = pathOf([point(fromX, runY - inner, -FURROW_DEPTH), point(toX, runY - inner, -FURROW_DEPTH), point(toX, runY + inner, -FURROW_DEPTH), point(fromX, runY + inner, -FURROW_DEPTH)], true);
    const farWall = pathOf([point(fromX, runY - inner, 0), point(toX, runY - inner, 0), point(toX, runY - inner, -FURROW_DEPTH), point(fromX, runY - inner, -FURROW_DEPTH)], true);
    back.push(`<path class="af-furrow-floor" d="${floor}"/><path class="af-furrow-wall" d="${farWall}"/>`);
    back.push(`<path class="iso-line" data-tone="lo" d="${pathOf([point(fromX, runY - inner, 0), point(toX, runY - inner, 0)])}${pathOf([point(fromX, runY - inner, -FURROW_DEPTH), point(toX, runY - inner, -FURROW_DEPTH)])}"/>`);
    // The berms: a low ridge of spoil each side, its crest a little off the lip; the near one hides the trench's near wall.
    for (const side of [-1, 1]) {
      const lipY = runY + side * inner;
      const crestY = runY + side * (inner + berm * 0.45);
      const outerY = runY + side * (inner + berm);
      const ridge = pathOf([point(fromX, lipY, 0), point(toX, lipY, 0), point(toX, crestY, BERM_HEIGHT), point(toX, outerY, 0), point(fromX, outerY, 0), point(fromX, crestY, BERM_HEIGHT)], true);
      const crest = pathOf([point(fromX, crestY, BERM_HEIGHT), point(toX, crestY, BERM_HEIGHT)]);
      (side > 0 ? front : back).push(`<path class="af-berm" d="${ridge}"/><path class="iso-line" data-tone="lo" d="${crest}"/><path class="iso-line" data-tone="faint" d="${pathOf([point(fromX, outerY, 0), point(toX, outerY, 0)])}"/>`);
    }
  }
  if (ploughAt) {
    // The spoil mound pushed up ahead of the flukes (clear of a cable they hold, which trails aft of them): a low
    // dome on the near lip, and clods of clay about it.
    const moundX = ploughAt[0] + MOUND_AHEAD_METRES;
    spoilParts.push(turnedPart("seabed.spoil", frameOf([moundX, runY + inner * 0.55, 0], [0, 0, 1], [1, 0, 0], AXIS_Y), [[0, 0], [0, 5.2], [0.8, 4.6, 1], [1.7, 3.0, 1], [2.3, 1.2, 1], [2.5, 0.05]], projection, { tone: "lo", className: "af-spoil" }));
    // Clods thrown just clear of the mound's foot (radius 5.2 m): [ahead of the flukes, sideways, radius] (m).
    const clods: [number, number, number][] = [
      [8.6, 2.4, 0.6],
      [8.4, -3.2, 0.45],
      [4.4, 6.4, 0.5],
      [9.4, 4.6, 0.35],
      [3.6, -5.4, 0.4],
    ];
    clods.forEach(([ahead, sideways, radius], index) => spoilParts.push(ballPart(`seabed.clod#${index}`, [moundX - 2.2 + ahead, runY + inner * 0.55 + sideways, radius * 0.6], radius, projection, { tone: "lo", className: "af-spoil" })));
  }
  return { back: back.join(""), front: front.join(""), spoilParts };
}

/** A cable's solids (painted with the anchor, far to near) and its line work on the cut face and the torn ends. */
type CableArt = { cut: string; parts: Part[] };

// A cable fades out over this many metres as it nears either end of the block, where the seabed's texture fades too.
const CABLE_FADE_METRES = 12;
// Within this distance across the track of the hook (m), the cable is cut at every centreline point (1.6 m apart).
const CABLE_FINE_REACH_METRES = 14;

const CABLE_STEPS = 40;

/** The cable's centreline: straight across the block, bowed forward to the flukes while snagged, parted in two after. */
function cableCentrelines(view: FigureView, cable: CableState, travelledMetres: number, hook: Point3): Point3[][] {
  const radius = view.cableRadius;
  const lyingX = cable.worldMetres - travelledMetres;
  // A parted cable springs back part of the way its ends were pulled (illustrated), then lies where it fell.
  const sinceParted = cable.phase.kind === "parted" ? Math.max(0, travelledMetres - cable.phase.atTravelledMetres - PART_PULL_METRES) : 0;
  const pull = readCablePull(cable, travelledMetres) * (cable.phase.kind === "parted" ? 0.55 + 0.45 * Math.exp(-sinceParted / 6) : 1);
  const apexY = hook[1];
  const y0 = BLOCK.y;
  const y1 = BLOCK.y + BLOCK.d;
  const bowAt = (acrossY: number) => {
    const reach = acrossY > apexY ? y1 - apexY : apexY - y0;
    const share = Math.min(1, Math.abs(acrossY - apexY) / reach);
    // A taut cable pulled by one point: nearly straight legs, rounded where the flukes hold it.
    return pull * Math.pow(1 - Math.sqrt(share * share + 0.0016) + 0.04, 1.15);
  };
  const lineFrom = (fromY: number, toY: number) =>
    Array.from({ length: CABLE_STEPS + 1 }, (_slot, index): Point3 => {
      const acrossY = fromY + ((toY - fromY) * index) / CABLE_STEPS;
      return [lyingX + bowAt(acrossY), acrossY, radius];
    });
  if (cable.phase.kind === "snagged") {
    // The bight follows the flukes exactly while the anchor holds it.
    const offset = hook[0] - (lyingX + bowAt(apexY));
    return [lineFrom(y0, y1).map(([alongX, acrossY, upZ]) => [alongX + offset * Math.max(0, 1 - Math.abs(acrossY - apexY) / 30), acrossY, upZ])];
  }
  if (cable.phase.kind === "parted") {
    const gap = 3.4 + Math.min(3.6, sinceParted * 0.3);
    return [lineFrom(y0, apexY - gap), lineFrom(apexY + gap, y1)];
  }
  return [lineFrom(y0, y1)];
}

// The cable's construction, as shares of its outer radius: a double-armoured telecom cable of the kind laid in the
// Baltic (C-Lion1 is a telecom cable; ITU-T G.978 describes the build: an optical unit of fibres in a steel tube, a
// strength member and copper power conductor round it, a polyethylene sheath, armour wires and an outer serving).
// C-Lion1's own armour is not published, so the layers here are the generic double-armoured design.
const CABLE_LAYERS = [
  { name: "serving", share: 1, step: 0 },
  { name: "armour", share: 0.86, step: 0 },
  { name: "sheath", share: 0.58, step: 1.4 },
  { name: "conductor", share: 0.4, step: 2.6 },
  { name: "core", share: 0.24, step: 3.7 },
] as const;
const ARMOUR_WIRES = 14;

/**
 * One cable as a tube on the seabed with its armour wound round it (the kit's rings, twisted into a helix), ending
 * flush with the block's cut faces where its section shows each layer; once parted, each torn end steps its layers
 * back like a stair (sheath, conductor, the steel tube with its fibres) with the armour wires splayed. Only the torn
 * ends are vermilion.
 */
export function buildCableArt(view: FigureView, cable: CableState, travelledMetres: number, hook: Point3): CableArt {
  const { projection } = view;
  const radius = view.cableRadius;
  const nearY = BLOCK.y + BLOCK.d;
  const cut: string[] = [];
  const parts: Part[] = [];
  const lines = cableCentrelines(view, cable, travelledMetres, hook);
  const xs = lines.flat().map(([alongX]) => alongX);
  const room = Math.min(Math.min(...xs) - BLOCK.x, BLOCK.x + BLOCK.w - Math.max(...xs)) - 2;
  const fade = Math.min(1, room / CABLE_FADE_METRES);
  if (fade <= 0) return { cut: "", parts: [] };
  // Every piece wears the cable's own colours (af-cable), faded near the block's ends.
  const faded = (markup: string) => `<g class="af-cable"${fade < 1 ? ` opacity="${fade.toFixed(2)}"` : ""}>${markup}</g>`;
  lines.forEach((centreline, lineIndex) => {
    // Short chunks only where the cable passes the anchor, so it paints between the anchor's parts there; long ones
    // elsewhere keep the per-frame markup small.
    const breaks: number[] = [];
    let along = 0;
    centreline.forEach((point, index) => {
      const previous = centreline[index - 1];
      if (previous) along += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
      if (Math.abs(point[1] - hook[1]) < CABLE_FINE_REACH_METRES) breaks.push(along);
    });
    const pieces = tubeParts(`cable#${lineIndex}`, centreline, radius, projection, { tone: "hi", rings: { pitch: 0.9, twist: 1.6, tone: "lo" }, maxLength: 12, breaks });
    parts.push(...pieces.map((piece) => ({ ...piece, svg: faded(piece.svg) })));
    const start = centreline[0];
    const end = centreline[centreline.length - 1];
    // The section where the cable meets the near cut face: serving, a ring of armour wires, sheath, conductor, core.
    for (const point of [start, end]) {
      if (!point || Math.abs(point[1] - nearY) > 0.01) continue;
      const face = frameOf(point, AXIS_Y, [1, 0, 0], [0, 0, 1]);
      cut.push(CABLE_LAYERS.map((layer) => `<path class="iso-line" data-tone="${layer.name === "serving" ? "hi" : "mid"}" d="${circleOf(face, 0, radius * layer.share, projection, 28)}"/>`).join(""));
      const wires = dotsOf(face, 0, radius * 0.79, ARMOUR_WIRES, projection, { all: true });
      cut.push(`<g class="iso-dots" data-tone="hi">${wires.map(([screenX, screenY]) => `<circle cx="${screenX.toFixed(1)}" cy="${screenY.toFixed(1)}" r="0.42"/>`).join("")}</g>`);
    }
    if (cable.phase.kind !== "parted") return;
    // The torn end: the end nearer the flukes, with its layers stepped back along the cable's own direction.
    const torn = lineIndex === 0 ? end : start;
    const before = lineIndex === 0 ? centreline[centreline.length - 2] : centreline[1];
    if (!torn || !before) return;
    const outward = unit3([torn[0] - before[0], torn[1] - before[1], torn[2] - before[2]]);
    const endFrame = frameOf(torn, outward, [0, 0, 1], unit3([outward[1], -outward[0], 0]));
    CABLE_LAYERS.slice(2).forEach((layer, index, stair) => {
      const from = index === 0 ? 0 : (stair[index - 1]?.step ?? 0);
      const look = { tone: "hi" as const, className: layer.name === "core" ? "af-torn" : undefined };
      const step = discPart(`cable.${layer.name}#${lineIndex}`, endFrame, from, layer.step, radius * layer.share, projection, look);
      parts.push({ ...step, svg: faded(step.svg) });
    });
    // Fibres in the steel tube's torn face, and the armour wires splayed out of the serving, their tips vermilion (a
    // torn wire's tip ends in the water, so it is marked free for the line-end check):
    // painted with the solids just after the stair, so whatever stands in front of the torn end covers them too.
    const frayed: string[] = [];
    frayed.push(`<g class="iso-dots af-fibres">${dotsOf(endFrame, CABLE_LAYERS[4].step, radius * 0.12, 6, projection, { all: true }).map(([screenX, screenY]) => `<circle cx="${screenX.toFixed(1)}" cy="${screenY.toFixed(1)}" r="0.3"/>`).join("")}</g>`);
    for (let wire = 0; wire < ARMOUR_WIRES; wire += 2) {
      const angle = (wire / ARMOUR_WIRES) * Math.PI * 2;
      const radial = add3(mul3(endFrame.u, Math.cos(angle)), mul3(endFrame.v, Math.sin(angle)));
      const root = add3(torn, mul3(radial, radius * 0.8));
      const bend = add3(root, add3(mul3(outward, 1.4), mul3(radial, 0.8)));
      const tip = add3(bend, add3(mul3(outward, 1.2), mul3(radial, 1.6 + (wire % 3) * 0.4)));
      frayed.push(`<path class="iso-line" data-tone="hi" d="${pathOf([iso(root, projection), iso(bend, projection)])}"/><path class="iso-line af-cut" data-free="end" d="${pathOf([iso(bend, projection), iso(tip, projection)])}"/>`);
    }
    parts.push(markupPart(`cable.frayed#${lineIndex}`, faded(frayed.join("")), add3(torn, mul3(outward, CABLE_LAYERS[4].step)), 2));
  });
  return { cut: faded(cut.join("")), parts };
}

/** The slide of the seabed texture under the block: aft by the distance travelled, wrapped to one period. */
export function slideTransform(view: FigureView, travelledMetres: number, period: number): string {
  const wrapped = ((travelledMetres % period) + period) % period;
  return translateAlong(view.projection, [-wrapped, 0, 0]);
}

/** Moves art drawn at the hawse's x to the anchor's x (the fallback silt rides with the flukes). */
export function alongTransform(view: FigureView, metres: number): string {
  return translateAlong(view.projection, [metres, 0, 0]);
}

/** The anchor's place for the cables: its hook, which is where a cable is caught. */
export function placeFlukes(anchorArt: AnchorArt, reading: ChainReading): AnchorPlace {
  return { aheadOfHawseMetres: anchorArt.hook[0], isOnSeabed: reading.kind === "grounded" && anchorArt.isDug };
}

/** The cable slots the figure draws: the spacing keeps at most two in or near the block. */
const CABLE_SLOTS = 2;

/** The cables lying in or near the block at a distance travelled, each in its phase for the dragging anchor's hook. */
export function layCablesNear(travelled: number, hookAheadMetres: number): CableState[] {
  const fromWorld = travelled + BLOCK.x - CABLE_SPACING_METRES * 0.25;
  const toWorld = travelled + BLOCK.x + BLOCK.w + CABLE_SPACING_METRES * 0.4;
  return layCables(fromWorld, toWorld, hookAheadMetres, travelled).slice(0, CABLE_SLOTS);
}

/** The furrow behind an anchor in the clay: from beyond the block's aft end (it has dragged all along) to its flukes. */
export function readFurrowRuns(travelled: number, anchor: AnchorArt): FurrowRun[] {
  return anchor.isDug ? [{ fromWorld: travelled + BLOCK.x - 40, toWorld: travelled + anchor.flukeTip[0] }] : [];
}

export const CHAIN_POINT_COUNT = 90;

/** The dragging anchor's hook along the track (m ahead of the hawse): where every cable is caught. */
export function readDragHook(facts: AnchorFigureFacts, view: FigureView): number {
  return buildAnchorArt(view, readChainAt(facts, view.dragPaidOut, CHAIN_POINT_COUNT)).hook[0];
}

/** The figure at one moment of the drag: the chain, the anchor, the furrow, the cables and the readout. */
function buildMomentFrame(facts: AnchorFigureFacts, view: FigureView, moment: { travelledMetres: number; paidOutMetres: number }, hookAheadMetres: number) {
  const reading = readChainAt(facts, moment.paidOutMetres, CHAIN_POINT_COUNT);
  const anchor = buildAnchorArt(view, reading);
  const runs = readFurrowRuns(moment.travelledMetres, anchor);
  const cables = layCablesNear(moment.travelledMetres, hookAheadMetres);
  const readout = describeReadout(facts, reading, describeCable(cables, placeFlukes(anchor, reading), moment.travelledMetres));
  return { moment, reading, anchor, runs, cables, readout };
}

/** The figure at one of its stages (readStageMoment in the model): what the drawing shows first, and each stage's end. */
export function buildStageFrame(facts: AnchorFigureFacts, view: FigureView, stage: FigureStage) {
  const hookAheadMetres = readDragHook(facts, view);
  const moment = readStageMoment(stage, { snagAtMetres: -hookAheadMetres, draggingPaidOutMetres: view.dragPaidOut });
  return { ...buildMomentFrame(facts, view, moment, hookAheadMetres), hookAheadMetres };
}
