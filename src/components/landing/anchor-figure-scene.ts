import { corners, iso, pathOf, segment, type Flat, type Plan, type Plane, type Point3 } from "@/components/iso/iso-kit";
import { circleOf, frameOf, hullOf, ribsOf } from "@/components/iso/lathe.mjs";
import {
  ballPart,
  discPart,
  extrudedPart,
  linePart,
  postPart,
  prismPart,
  slabPart,
  tubeParts,
  turnedPart,
  type Part,
} from "@/components/landing/anchor-figure-parts";
import { PART_PULL_METRES } from "@/lib/landing/anchor-figure-model";
import { BLOCK, FOOT_HEIGHT, PLINTH, PLINTH_BOTTOM, SEDIMENT_BOTTOM, TEXTURE_PERIOD_METRES, halfBreadthAt, type FigureView } from "@/components/landing/anchor-figure-view";

// Every static part of the anchor figure, built once (on the server, for the figure's SVG route, and in the audit
// script) from the figure's world: the plinth and the block of sea with its clay strata, the seabed's ripples and
// stones, the water, the bow of Eagle S with its deck gear, and the depth scale. The anchor, chain, furrow and cables
// change with the reader's chain and are built per frame (anchor-figure-frame.ts).
//
// Ship parts follow Eagle S's proportions (src/lib/ships/ship-specs.ts, read off the Wikimedia photograph there): a
// low forecastle with a bulwark, a bulbous bow, the deck pipes and the cargo manifold amidships. Their deck gear is
// what an oil tanker of this size carries (OCIMF, "Mooring Equipment Guidelines", 4th edition, 2018: windlasses,
// bitts and fairleads at the forecastle; a midships manifold with a hose crane), drawn at true scale.

const AXIS_X: Point3 = [1, 0, 0];
const AXIS_Y: Point3 = [0, 1, 0];
const AXIS_Z: Point3 = [0, 0, 1];
// How far inside the block's aft end the ship's break line runs (m).
const BREAK_AFT_METRES = 6;

/**
 * The hull's waterplane at height z as a ring, from `fromX` to the stem: starboard first, back along port. With a bulb,
 * the stem runs out into the bulb's rounded nose and the waterlines swell into it over its fairing length.
 */
function hullRing(view: FigureView, fromX: number, z: number, inset = 0, bulb: { nose: number; radius: number } | null = null): Plane[] {
  const steps = 36;
  const stem = view.ship.stemX;
  const fairing = 12;
  const bulbHalfAt = (alongX: number) => {
    if (!bulb) return 0;
    if (alongX >= stem) return bulb.radius * Math.sqrt(Math.max(0, 1 - ((alongX - stem) / bulb.nose) ** 2));
    return bulb.radius * Math.max(0, 1 - ((stem - alongX) / fairing) ** 2);
  };
  const noseSteps = bulb ? 8 : 0;
  const nose: Plane[] = Array.from({ length: noseSteps }, (_slot, index) => {
    const alongX = stem + (bulb?.nose ?? 0) * (1 - index / noseSteps);
    return [alongX, bulbHalfAt(alongX)];
  });
  const starboard: Plane[] = [
    ...nose,
    ...Array.from({ length: steps + 1 }, (_slot, index): Plane => {
      const alongX = stem - ((stem - fromX) * index) / steps;
      return [alongX, Math.max(0, Math.max(halfBreadthAt(view, alongX, z), bulbHalfAt(alongX)) - inset)];
    }),
  ];
  const port = [...starboard].reverse().map(([alongX, acrossY]): Plane => [alongX, -acrossY]);
  return [...starboard, ...port].filter((point, index, all) => index === 0 || point[0] !== all[index - 1]?.[0] || point[1] !== all[index - 1]?.[1]);
}

/** The block: plinth on six feet with a label plate and screws, clay in three strata with pebbles in section. */
function buildBlock(view: FigureView): Part[] {
  const { projection } = view;
  const parts: Part[] = [];
  const feetAt: Plane[] = [...corners(PLINTH, 12), [PLINTH.x + PLINTH.w / 2, PLINTH.y + 12], [PLINTH.x + PLINTH.w / 2, PLINTH.y + PLINTH.d - 12]];
  feetAt.forEach((centre, index) => {
    parts.push(postPart(`stand.foot.flange#${index}`, centre, 4.6, PLINTH_BOTTOM - FOOT_HEIGHT, 0.9, projection, { tone: "lo", bias: -40 }));
    parts.push(postPart(`stand.foot#${index}`, centre, 3.4, PLINTH_BOTTOM - FOOT_HEIGHT + 0.9, FOOT_HEIGHT - 0.9, projection, { tone: "mid", bias: -39 }));
  });
  parts.push(slabPart("stand.plinth", PLINTH, PLINTH_BOTTOM, SEDIMENT_BOTTOM - PLINTH_BOTTOM, projection, { tone: "mid", steps: 4, bevel: 0.6, bias: -30 }));
  // The label plate on the plinth's near margin, with three rule lines standing for its printed text and two screws.
  const plate: Plan = { x: BLOCK.x + 6, y: BLOCK.y + BLOCK.d + 0.4, w: 26, d: 2.2, r: 0.4 };
  parts.push(slabPart("stand.label", plate, SEDIMENT_BOTTOM, 0.3, projection, { tone: "mid", bias: -20 }));
  const rule = (fromX: number, toX: number, y: number) => pathOf([iso([fromX, y, SEDIMENT_BOTTOM + 0.3], projection), iso([toX, y, SEDIMENT_BOTTOM + 0.3], projection)]);
  parts.push(linePart("stand.label.rules", rule(plate.x + 3, plate.x + 20, plate.y + 0.6) + rule(plate.x + 3, plate.x + 15, plate.y + 1.1) + rule(plate.x + 3, plate.x + 18, plate.y + 1.6), [plate.x + 12, plate.y + 1, SEDIMENT_BOTTOM], { tone: "lo", free: true, bias: -19 }));
  const screws = [...corners(PLINTH, 1.6), [plate.x + 1.2, plate.y + 1.1] as Plane, [plate.x + plate.w - 1.2, plate.y + 1.1] as Plane].map(([alongX, acrossY]) => iso([alongX, acrossY, SEDIMENT_BOTTOM + 0.3], projection));
  parts.push({ name: "stand.screws", svg: `<g class="iso-dots" data-tone="mid">${screws.map(([screenX, screenY]) => `<circle cx="${screenX.toFixed(1)}" cy="${screenY.toFixed(1)}" r="0.55"/>`).join("")}</g>`, at: [0, 0, SEDIMENT_BOTTOM], bias: -18, shapes: [] });
  // Clay in three strata (Baltic postglacial clay over glacial clay over till), each its own slab, darker with depth.
  const strata: [number, number, "lo" | "mid"][] = [
    [SEDIMENT_BOTTOM, -6.8, "lo"],
    [-6.8, -3.4, "lo"],
    [-3.4, 0, "mid"],
  ];
  strata.forEach(([bottom, top, tone], index) => parts.push(slabPart(`stand.clay#${index}`, BLOCK, bottom, top - bottom, projection, { tone, steps: 1, bias: -10 + index, className: `af-clay af-clay-${index}` })));
  // Pebbles and shells in the cut faces: closed outlines on the near face (y = BLOCK.y + BLOCK.d) and the end face.
  const nearY = BLOCK.y + BLOCK.d;
  const endX = BLOCK.x + BLOCK.w;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const pebbles: string[] = [];
  for (let index = 0; index < 46; index += 1) {
    const radius = 0.35 + random() * 0.9;
    const height = SEDIMENT_BOTTOM + radius + 0.3 + random() * (-SEDIMENT_BOTTOM - 2 * radius - 0.6);
    const isEnd = index % 6 === 0;
    const across = isEnd ? BLOCK.y + 2 + random() * (BLOCK.d - 4) : BLOCK.x + 3 + random() * (BLOCK.w - 6);
    const outline = Array.from({ length: 10 }, (_slot, step) => {
      const angle = (step / 10) * Math.PI * 2;
      const wobble = 1 + 0.18 * Math.sin(angle * 3 + index);
      const point: Point3 = isEnd ? [endX, across + radius * 1.3 * wobble * Math.cos(angle), height + radius * 0.7 * wobble * Math.sin(angle)] : [across + radius * 1.3 * wobble * Math.cos(angle), nearY, height + radius * 0.7 * wobble * Math.sin(angle)];
      return iso(point, projection);
    });
    pebbles.push(pathOf(outline, true));
  }
  parts.push(linePart("stand.clay.pebbles", pebbles.join(""), [endX, nearY, -5], { tone: "lo", bias: -5 }));
  return parts;
}

/** One period of seabed texture (stones and shells), laid over the block and one period more; it slides as one. */
function buildSeabedTexture(view: FigureView): { parts: Part[]; period: number } {
  const { projection } = view;
  const period = TEXTURE_PERIOD_METRES;
  const parts: Part[] = [];
  const copies = Math.ceil(BLOCK.w / period) + 1;
  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Stones keep out of the anchor's lane (its width and 4 m each side): the flukes would have ploughed them aside.
  const laneFrom = view.chainY - view.anchor.halfWidth - 4;
  const laneTo = view.chainY + view.anchor.halfWidth + 4;
  const nearFrom = BLOCK.y + 2;
  const farTo = BLOCK.y + BLOCK.d - 2;
  const outsideLane = (share: number) => {
    const reach = share * (laneFrom - nearFrom + (farTo - laneTo));
    return reach < laneFrom - nearFrom ? nearFrom + reach : laneTo + (reach - (laneFrom - nearFrom));
  };
  // Stones keep off the cables' lines too. The cables lie a whole number of texture periods apart (CABLE_SPACING_METRES
  // is 5 periods), so on the texture they all lie at one place, `cableAlong`; a stone keeps 3 m aft of it and clear of
  // the 16 m a snagged cable is dragged forward (PART_PULL_METRES), plus a stone's largest radius.
  const cableAlong = (((-BLOCK.x) % period) + period) % period;
  const keepAft = 3 + 1.9;
  const keepAhead = PART_PULL_METRES + 3 + 1.9;
  const stoneAlong = (share: number) => (cableAlong + keepAhead + share * (period - keepAft - keepAhead)) % period;
  const stoneSpots: [number, number, number][] = Array.from({ length: 16 }, () => [stoneAlong(random()), outsideLane(random()), 0.5 + random() * 1.4]);
  const shellSpots: Plane[] = Array.from({ length: 40 }, () => [random() * period, BLOCK.y + 1 + random() * (BLOCK.d - 2)]);
  for (let copy = 0; copy < copies; copy += 1) {
    const offset = BLOCK.x + copy * period;
    stoneSpots.forEach(([along, across, radius], index) => {
      // Boulders and cobbles of the glacial till that reaches the seabed: low, rounded, half sunk in the clay.
      parts.push(slabPart(`seabed.stone#${copy}.${index}`, { x: offset + along - radius, y: across - radius * 0.8, w: radius * 2, d: radius * 1.6, r: radius * 0.7 }, 0, radius * 0.55, projection, { tone: "lo", steps: 4, bevel: 0.2 }));
    });
    const shells = shellSpots.map(([along, across]) => iso([offset + along, across, 0], projection));
    parts.push({ name: `seabed.shells#${copy}`, svg: `<g class="iso-dots" data-tone="lo">${shells.map(([screenX, screenY]) => `<circle cx="${screenX.toFixed(1)}" cy="${screenY.toFixed(1)}" r="0.35"/>`).join("")}</g>`, at: [offset, 0, 0], bias: -1, shapes: [] });
  }
  return { parts, period };
}

/** Ripple crests every this many metres along the track, across the seabed (a divisor of the texture's period). */
const RIPPLE_SPACING_METRES = 4;

/**
 * The seabed's ripples for a distance travelled: crests every 4 m fixed in the world, each running edge to edge of the
 * seabed face so it ends on the block's top edges (the line-end rule), and only those inside the block: drawn per
 * moment rather than slid, so no crest hides past the block's ends.
 */
export function buildRipples(view: FigureView, travelledMetres: number): string {
  const period = TEXTURE_PERIOD_METRES;
  const wrapped = ((travelledMetres % period) + period) % period;
  const crests: string[] = [];
  for (let along = 2; along < period * 3; along += RIPPLE_SPACING_METRES) {
    const alongX = BLOCK.x + along - wrapped;
    if (alongX < BLOCK.x + 1.5 || alongX > BLOCK.x + BLOCK.w - 1.5) continue;
    // The crest's wobble keeps to its place on the texture, so a crest keeps its shape as it slides.
    const phase = (along % period) * 0.7;
    const points: Flat[] = [];
    for (let step = 0; step <= 20; step += 1) {
      const acrossY = BLOCK.y + (BLOCK.d * step) / 20;
      points.push(iso([alongX + 0.9 * Math.sin(acrossY * 0.21 + phase), acrossY, 0], view.projection));
    }
    crests.push(pathOf(points));
  }
  return crests.length ? `<path class="iso-line" data-tone="faint" d="${crests.join("")}"/>` : "";
}

/** The water's far edges and the surface's rules, drawn behind the ship. */
function buildWater(view: FigureView): { back: Part[]; surface: Part[]; front: Part[] } {
  const { projection, depth } = view;
  const x0 = BLOCK.x;
  const x1 = BLOCK.x + BLOCK.w;
  const y0 = BLOCK.y;
  const y1 = BLOCK.y + BLOCK.d;
  const rise = (alongX: number, acrossY: number) => segment([alongX, acrossY, 0], [alongX, acrossY, depth], projection);
  const back = [linePart("water.back", rise(x0, y0) + rise(x1, y0) + segment([x0, y0, depth], [x1, y0, depth], projection) + segment([x0, y0, depth], [x0, y1, depth], projection), [x0, y0, 0], { tone: "lo", bias: -50 })];
  // Surface rules along the track, edge to edge, closer together far off, the way the engravings shade water.
  const hatch: string[] = [];
  for (let acrossY = y0 + 2.5, step = 2.5; acrossY < y1 - 0.5; acrossY += step, step = Math.min(5, step * 1.08)) hatch.push(segment([x0, acrossY, depth], [x1, acrossY, depth], projection));
  const surface = [
    linePart("water.surface.rules", hatch.join(""), [x0, y0, depth], { tone: "faint", className: "af-surface-hatch", bias: -1 }),
    linePart("water.surface.edges", segment([x0, y1, depth], [x1, y1, depth], projection) + segment([x1, y0, depth], [x1, y1, depth], projection), [x1, y1, depth], { tone: "mid", bias: 0 }),
  ];
  const front = [linePart("water.front", rise(x0, y1) + rise(x1, y1), [x1, y1, 0], { tone: "lo", bias: 200 })];
  return { back, surface, front };
}

/** The hull below the water: bottom, bilge strake and the run up to the boot top, the bulbous bow, the draught marks. */
function buildHullUnderwater(view: FigureView): Part[] {
  const { projection, ship, depth } = view;
  const fromX = BLOCK.x;
  const parts: Part[] = [];
  // Three strakes, each a little fuller than the one under it, so the bilge and the bow's flare read as steps of plating.
  // The bulbous bow is plated into the middle strake: its nose stands 1.44 radii ahead of the stem (vessel-profile.ts)
  // and the waterlines swell into it, so the bulb grows out of the stem rather than sitting on it.
  const bulbRadius = 0.096 * 2 * ship.halfBeam;
  const bulbAxisZ = ship.keelZ + 0.42 * ship.draught;
  // In three strakes stepped like an ellipsoid's waterlines: the middle one full, those over and under it 0.8 of it.
  const bulbAt = (share: number) => ({ nose: 1.44 * bulbRadius * share, radius: bulbRadius * share });
  const bands: [number, { nose: number; radius: number } | null][] = [
    [ship.keelZ, null],
    [bulbAxisZ - bulbRadius * 0.9, bulbAt(0.8)],
    [bulbAxisZ - bulbRadius * 0.35, bulbAt(1)],
    [bulbAxisZ + bulbRadius * 0.35, bulbAt(0.8)],
    [bulbAxisZ + bulbRadius * 0.9, null],
    [depth - 1.4, null],
  ];
  for (let index = 0; index < bands.length - 1; index += 1) {
    const [bottom, bulb] = bands[index] ?? [ship.keelZ, null];
    const top = bands[index + 1]?.[0] ?? depth;
    parts.push(extrudedPart(`ship.hull.strake#${index}`, hullRing(view, fromX, bottom, index === 0 ? 1.6 : 0, bulb), bottom, top - bottom, projection, { tone: "mid", bias: -60 + index }));
  }
  parts.push(extrudedPart("ship.hull.boottop", hullRing(view, fromX, depth), depth - 1.4, 1.4, projection, { tone: "mid", bias: -56, className: "af-boottop" }));
  // Draught marks on the near side of the parallel body: a rule each metre from the keel to the water, longer every 2.
  const marksX = -62;
  const marks: string[] = [];
  for (let height = 1; height <= ship.draught; height += 1) {
    const isLong = height % 2 === 0;
    marks.push(segment([marksX, ship.halfBeam, ship.keelZ + height], [marksX + (isLong ? 2.4 : 1.2), ship.halfBeam, ship.keelZ + height], projection));
  }
  parts.push(linePart("ship.hull.draught-marks", marks.join(""), [marksX, ship.halfBeam, ship.keelZ + 6], { tone: "mid", bias: -40, free: true }));
  return parts;
}

/** The hull above the water and everything on its decks. */
function buildShipAbove(view: FigureView): Part[] {
  const { projection, ship, depth } = view;
  const fromX = BLOCK.x;
  const parts: Part[] = [];
  const deckZ = ship.deckZ;
  // Topsides in two strakes with a sheer strake rule between them; the forecastle raised over the bow's last tenth.
  parts.push(extrudedPart("ship.hull.topsides", hullRing(view, fromX, depth + 2), depth, ship.freeboard - 2.2, projection, { tone: "hi", bias: -30 }));
  parts.push(extrudedPart("ship.hull.sheer", hullRing(view, fromX, deckZ), deckZ - 2.2, 2.2, projection, { tone: "hi", bias: -29 }));
  const forecastleFrom = ship.stemX - 0.1 * ship.length;
  const forecastleTop = deckZ + 2.6;
  parts.push(extrudedPart("ship.forecastle", hullRing(view, forecastleFrom, deckZ, 0.25).filter((point) => point[0] >= forecastleFrom - 0.01), deckZ, 2.6, projection, { tone: "hi", bias: -20 }));
  // The bulwark round the forecastle: posts every 2.4 m and a top rail, so the rail ends on its last post.
  const railPosts: Point3[] = [];
  const bulwarkSide = (side: 1 | -1) => {
    const points: Point3[] = [];
    for (let alongX = forecastleFrom + 1; alongX < ship.stemX - 1.5; alongX += 2.4) {
      const acrossY = side * (halfBreadthAt(view, alongX, forecastleTop) - 0.5);
      points.push([alongX, acrossY, forecastleTop]);
    }
    return points;
  };
  for (const side of [1, -1] as const) {
    const posts = bulwarkSide(side);
    posts.forEach((point, index) => {
      parts.push(postPart(`ship.forecastle.post#${side}.${index}`, [point[0], point[1]], 0.18, forecastleTop, 1.2, projection, { tone: "mid", steps: 8, bias: 2 }));
      railPosts.push(point);
    });
    const rail = pathOf(posts.map(([alongX, acrossY, height]) => iso([alongX, acrossY, height + 1.2], projection)));
    parts.push(linePart(`ship.forecastle.rail#${side}`, rail, posts[Math.floor(posts.length / 2)] ?? [0, 0, forecastleTop], { tone: "mid", bias: 3 }));
  }
  // Windlasses: a bedplate, the gypsy (cable lifter) whose whelps grip the links, the warping drum and the motor.
  for (const side of [1, -1] as const) {
    const centreX = ship.stemX - 15;
    const centreY = side * 4.4;
    parts.push(slabPart(`ship.windlass.bed#${side}`, { x: centreX - 2.6, y: centreY - 2.2, w: 5.2, d: 4.4, r: 0.4 }, forecastleTop, 0.6, projection, { tone: "mid", bias: 4 }));
    const gypsyFrame = frameOf([centreX, centreY - side * 0.4, forecastleTop + 2.2], AXIS_Y, AXIS_X, AXIS_Z);
    parts.push(discPart(`ship.windlass.gypsy#${side}`, gypsyFrame, -0.7, 0.7, 1.6, projection, { tone: "hi", bias: 6, inner: lineSvgOf(ribsOf(gypsyFrame, -0.7, 0.7, 1.6, 9, projection)) }));
    parts.push(discPart(`ship.windlass.brake#${side}`, gypsyFrame, 0.7, 1.1, 1.9, projection, { tone: "mid", bias: 7 }));
    parts.push(discPart(`ship.windlass.drum#${side}`, gypsyFrame, -2.2, -0.7, 1.0, projection, { tone: "mid", bias: 5 }));
    parts.push(slabPart(`ship.windlass.motor#${side}`, { x: centreX + 1.6, y: centreY - 1.2, w: 2.2, d: 2.4, r: 0.3 }, forecastleTop + 0.6, 2.0, projection, { tone: "mid", bias: 6 }));
    // The chain stopper between the gypsy and the hawse pipe: a bar on two cheeks.
    parts.push(slabPart(`ship.stopper#${side}`, { x: ship.stemX - 10.5, y: side * 5.4 - 0.8, w: 2.6, d: 1.6, r: 0.2 }, forecastleTop, 0.9, projection, { tone: "mid", bias: 6 }));
    // The chain pipe down to the locker, aft of the gypsy.
    parts.push(postPart(`ship.chainpipe#${side}`, [centreX - 3.6, centreY], 0.7, forecastleTop, 0.8, projection, { tone: "mid", steps: 14, bias: 5 }));
  }
  // Mooring bitts in pairs on a base plate, and fairleads at the bulwark.
  const bitts: [number, number, number][] = [
    [ship.stemX - 6.5, 3.2, forecastleTop],
    [ship.stemX - 6.5, -3.2, forecastleTop],
    [forecastleFrom + 4, 6.5, forecastleTop],
    [forecastleFrom + 4, -6.5, forecastleTop],
    [-60, ship.halfBeam - 2.4, deckZ],
    [-60, -(ship.halfBeam - 2.4), deckZ],
    [-84, ship.halfBeam - 2.4, deckZ],
    [-84, -(ship.halfBeam - 2.4), deckZ],
  ];
  bitts.forEach(([alongX, acrossY, z], index) => {
    parts.push(slabPart(`ship.bitt.base#${index}`, { x: alongX - 1.5, y: acrossY - 0.6, w: 3, d: 1.2, r: 0.3 }, z, 0.25, projection, { tone: "mid", bias: 3 }));
    for (const offset of [-0.8, 0.8]) parts.push(postPart(`ship.bitt.post#${index}.${offset}`, [alongX + offset, acrossY], 0.45, z + 0.25, 1.1, projection, { tone: "hi", steps: 12, bias: 4 }));
  });
  // The breakwater: a V of plate on the main deck just aft of the forecastle, shedding green seas over the side.
  for (const side of [1, -1] as const) {
    const arm: Plane[] = [
      [forecastleFrom - 2, 0],
      [forecastleFrom - 7, side * (ship.halfBeam - 2)],
      [forecastleFrom - 7.6, side * (ship.halfBeam - 2)],
      [forecastleFrom - 2.6, 0],
    ];
    parts.push(extrudedPart(`ship.breakwater#${side}`, arm, deckZ, 2.4, projection, { tone: "hi", bias: side > 0 ? -4 : -5 }));
  }
  // The foremast on the forecastle: a post, a platform with the masthead light.
  parts.push(postPart("ship.foremast", [ship.stemX - 11, 0], 0.4, forecastleTop, 7.5, projection, { tone: "hi", steps: 12, bias: 8 }));
  parts.push(postPart("ship.foremast.top", [ship.stemX - 11, 0], 0.3, forecastleTop + 7.8, 3.2, projection, { tone: "hi", steps: 12, bias: 10 }));
  parts.push(slabPart("ship.foremast.platform", { x: ship.stemX - 12.2, y: -1.2, w: 2.4, d: 2.4, r: 0.4 }, forecastleTop + 7.5, 0.3, projection, { tone: "mid", bias: 9 }));
  parts.push(ballPart("ship.foremast.light", [ship.stemX - 11, 0, forecastleTop + 11.4], 0.45, projection, { tone: "hi", bias: 9 }));
  // The catwalk on the centreline, raised on legs every 8 m, from aft (the block's cut) to the breakwater.
  const catwalkZ = deckZ + 2.2;
  parts.push(slabPart("ship.catwalk", { x: fromX, y: -0.7, w: forecastleFrom - 8 - fromX, d: 1.4, r: 0 }, catwalkZ, 0.25, projection, { tone: "hi", steps: 1, bias: 10 }));
  for (let alongX = fromX + 4, index = 0; alongX < forecastleFrom - 10; alongX += 8, index += 1) parts.push(postPart(`ship.catwalk.leg#${index}`, [alongX, 0], 0.16, deckZ, 2.2, projection, { tone: "mid", steps: 8, bias: 1 }));
  // The cargo pipes along the deck on their supports, each run ending forward in an elbow into a flange on the deck.
  const pipeYs = [-3.4, -2.0, 2.4];
  pipeYs.forEach((acrossY, index) => {
    const endX = -34 - index * 6;
    const route: Point3[] = [
      [fromX, acrossY, deckZ + 0.9],
      [endX - 1.4, acrossY, deckZ + 0.9],
      [endX, acrossY, deckZ + 0.4],
      [endX, acrossY, deckZ + 0.12],
    ];
    parts.push(...tubeParts(`ship.pipe#${index}`, route, 0.38, projection, { tone: "hi", caps: [false, true], maxLength: 24 }));
    parts.push(discPart(`ship.pipe.flange#${index}`, frameOf([endX, acrossY, deckZ], AXIS_Z, AXIS_X, AXIS_Y), 0, 0.18, 0.62, projection, { tone: "mid", bias: 0.4 }));
    for (let alongX = fromX + 6; alongX < endX - 3; alongX += 10) parts.push(slabPart(`ship.pipe.support#${index}.${Math.round(alongX)}`, { x: alongX - 0.3, y: acrossY - 0.45, w: 0.6, d: 0.9, r: 0.1 }, deckZ, 0.52, projection, { tone: "mid", steps: 1, bias: -0.5 }));
  });
  // The cargo manifold amidships: crossover pipes to both sides, each ending in a valve and a flanged connection over
  // the drip tray, with the hose crane beside it.
  const manifoldX = ship.sternX + 0.5 * ship.length;
  parts.push(slabPart("ship.manifold.tray#near", { x: manifoldX - 7, y: ship.halfBeam - 4.4, w: 14, d: 3.2, r: 0.3 }, deckZ, 0.35, projection, { tone: "mid", bias: 0.2 }));
  parts.push(slabPart("ship.manifold.tray#far", { x: manifoldX - 7, y: -(ship.halfBeam - 1.2), w: 14, d: 3.2, r: 0.3 }, deckZ, 0.35, projection, { tone: "mid", bias: 0.2 }));
  for (let index = 0; index < 4; index += 1) {
    const alongX = manifoldX - 5.4 + index * 3.6;
    for (const side of [1, -1] as const) {
      const outerY = side * (ship.halfBeam - 2.2);
      parts.push(...tubeParts(`ship.manifold.cross#${index}.${side}`, [[alongX, side * 0.9, deckZ + 1.3], [alongX, outerY + side * -1.8, deckZ + 1.3]], 0.3, projection, { tone: "hi", maxLength: 30 }));
      const valveFrame = frameOf([alongX, outerY - side * 1.8, deckZ + 1.3], [0, side, 0], AXIS_X, AXIS_Z);
      parts.push(turnedPart(`ship.manifold.valve#${index}.${side}`, valveFrame, [[0, 0.42], [0.2, 0.42], [0.25, 0.62, 1], [0.6, 0.72, 1], [0.95, 0.62, 1], [1.0, 0.42], [1.2, 0.42], [1.2, 0.56], [1.4, 0.56]], projection, { tone: "hi", bias: 1 }));
      parts.push(postPart(`ship.manifold.stem#${index}.${side}`, [alongX, outerY - side * 1.1], 0.08, deckZ + 1.9, 0.6, projection, { tone: "mid", steps: 6, bias: 2 }));
      parts.push(linePart(`ship.manifold.wheel#${index}.${side}`, circleOf(frameOf([alongX, outerY - side * 1.1, deckZ + 2.5], AXIS_Z, AXIS_X, AXIS_Y), 0, 0.42, projection), [alongX, outerY - side * 1.1, deckZ + 2.5], { tone: "hi", bias: 2.1 }));
      parts.push(postPart(`ship.manifold.leg#${index}.${side}`, [alongX, outerY - side * 0.4], 0.12, deckZ + 0.35, 0.95, projection, { tone: "mid", steps: 6, bias: 0.5 }));
    }
  }
  // The hose crane: pedestal, slewing ring, house, jib.
  const craneX = manifoldX + 9;
  const craneY = ship.halfBeam - 5;
  parts.push(postPart("ship.crane.pedestal", [craneX, craneY], 0.8, deckZ, 6, projection, { tone: "hi", steps: 16, bias: 3 }));
  parts.push(postPart("ship.crane.ring", [craneX, craneY], 1.2, deckZ + 6, 0.5, projection, { tone: "mid", steps: 18, bias: 3.1 }));
  parts.push(slabPart("ship.crane.house", { x: craneX - 1.3, y: craneY - 1, w: 2.6, d: 2, r: 0.3 }, deckZ + 6.5, 1.6, projection, { tone: "hi", bias: 3.2 }));
  const jibDirection: Point3 = [-Math.cos(0.5), 0, Math.sin(0.5)];
  // The jib's heel sits on the house roof (deckZ + 8.1) and rises aft from there.
  parts.push(prismPart("ship.crane.jib", frameOf([craneX, craneY, deckZ + 8.1 + 0.3], jibDirection, AXIS_Y, [Math.sin(0.5), 0, Math.cos(0.5)]), [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], 0, 14, projection, { tone: "hi", bias: 3.3 }));
  // Tank hatches (round, on coamings) and the pressure-vacuum vent masts along the cargo deck.
  for (let index = 0; index < 8; index += 1) {
    const alongX = fromX + 12 + index * 16.5;
    // Clear of the manifold, and of the forecastle (the vent mast stands 3.2 m forward of its hatch).
    if (Math.abs(alongX - manifoldX) < 10 || alongX + 3.2 + 1.5 > forecastleFrom - 8) continue;
    const acrossY = index % 2 === 0 ? 6.6 : -6.6;
    parts.push(postPart(`ship.hatch.coaming#${index}`, [alongX, acrossY], 1.1, deckZ, 0.6, projection, { tone: "mid", steps: 16, bias: 1 }));
    parts.push(turnedPart(`ship.hatch.cover#${index}`, frameOf([alongX, acrossY, deckZ + 0.6], AXIS_Z, AXIS_X, AXIS_Y), [[0, 1.25], [0.15, 1.25], [0.3, 0.9, 1], [0.42, 0.4, 1], [0.46, 0.05]], projection, { tone: "hi", bias: 1.2 }));
    parts.push(postPart(`ship.vent#${index}`, [alongX + 3.2, -acrossY * 0.55], 0.22, deckZ, 3.4, projection, { tone: "mid", steps: 10, bias: 2 }));
    parts.push(postPart(`ship.vent.head#${index}`, [alongX + 3.2, -acrossY * 0.55], 0.42, deckZ + 3.4, 0.6, projection, { tone: "hi", steps: 12, bias: 2.1 }));
  }
  // Deck-edge rails on stanchions every 4 m, from the block's cut to the forecastle, on both sides.
  for (const side of [1, -1] as const) {
    const stanchions: Point3[] = [];
    for (let alongX = fromX + 1.5; alongX < forecastleFrom - 0.5; alongX += 4) stanchions.push([alongX, side * (halfBreadthAt(view, alongX, deckZ) - 0.4), deckZ]);
    stanchions.forEach((point, index) => parts.push(postPart(`ship.rail.post#${side}.${index}`, [point[0], point[1]], 0.13, deckZ, 1.1, projection, { tone: "mid", steps: 6, bias: side > 0 ? 12 : -2 })));
    const rail = pathOf(stanchions.map(([alongX, acrossY, height]) => iso([alongX, acrossY, height + 1.1], projection)));
    const midRail = pathOf(stanchions.map(([alongX, acrossY, height]) => iso([alongX, acrossY, height + 0.55], projection)));
    parts.push(linePart(`ship.rail#${side}`, rail + midRail, [(fromX + forecastleFrom) / 2, side * ship.halfBeam, deckZ + 1], { tone: "mid", bias: side > 0 ? 13 : -1 }));
  }
  // The hawse pipe's mouth on the starboard bow, where the chain leaves the hull, in its recessed anchor pocket.
  const [hawseX, hawseY, hawseZ] = view.hawse;
  const pocket: Point3[] = Array.from({ length: 18 }, (_slot, index) => {
    const angle = (index / 18) * Math.PI * 2;
    return [hawseX + 3.2 * Math.cos(angle), hawseY + 0.15, hawseZ - 1 + 2.4 * Math.sin(angle)];
  });
  parts.push({ name: "ship.hawse.pocket", svg: `<path class="af-pocket" d="${pathOf(pocket.map((point) => iso(point, projection)), true)}"/>`, at: [hawseX, hawseY, hawseZ], bias: 30, shapes: [] });
  // The lip lies flat on the strake (its normal across the ship); the pipe behind it runs down and aft.
  const hawseFrame = frameOf([hawseX, hawseY, hawseZ], AXIS_Y, AXIS_X, AXIS_Z);
  parts.push(turnedPart("ship.hawse.lip", hawseFrame, [[0.2, 1.25], [0.2, 1.7], [0.8, 1.7], [0.8, 1.25]], projection, { tone: "hi", bias: 31 }));
  // The waterline along the near side, where the hull meets the surface, and the bow wave folding off the stem.
  const waterline = pathOf(hullRing(view, fromX, depth).slice(0, 37).map(([alongX, acrossY]) => iso([alongX, acrossY, depth], projection)));
  parts.push(linePart("water.waterline", waterline, [0, ship.halfBeam, depth], { tone: "hi", bias: -31 }));
  // The ship is drawn to here on purpose: a break line (the draughtsman's sign for "continues") across the deck and
  // down the near side, a few metres inside the block's aft end. Eagle S runs on another 110 m aft to her house.
  const breakAt = (sway: number) => fromX + BREAK_AFT_METRES + 1.1 * Math.sin(sway);
  const deckBreak = Array.from({ length: 13 }, (_slot, step) => {
    const acrossY = ship.halfBeam - (2 * ship.halfBeam * step) / 12;
    return iso([breakAt(acrossY * 0.35), acrossY, deckZ], projection);
  });
  const sideBreak = Array.from({ length: 9 }, (_slot, step) => {
    const height = deckZ - ((deckZ - depth) * step) / 8;
    return iso([breakAt(ship.halfBeam * 0.35 + (deckZ - height) * 0.5), ship.halfBeam, height], projection);
  });
  parts.push(linePart("ship.break", pathOf(deckBreak) + pathOf(sideBreak), [fromX + BREAK_AFT_METRES, ship.halfBeam, deckZ], { tone: "hi", bias: 40 }));
  return parts;
}

function lineSvgOf(d: string): string {
  return d ? `<path class="iso-line" data-tone="faint" d="${d}"/>` : "";
}

/** The depth scale on the block's near corner: a square post on a foot, a tick every 5 m and a longer one every 10 m. */
function buildScale(view: FigureView): Part[] {
  const { projection, depth } = view;
  // On the aft near corner, clear of the chain, which comes down at the forward end.
  const postX = BLOCK.x - 3;
  const postY = BLOCK.y + BLOCK.d + 3;
  const minor: string[] = [];
  const major: string[] = [];
  for (let height = 5; height < depth + 0.5; height += 5) {
    const isMajor = height % 10 === 0;
    (isMajor ? major : minor).push(segment([postX - 1.1, postY + 1.1, height], [postX - 1.1 + (isMajor ? 2.2 : 1.1), postY + 1.1, height], projection));
  }
  return [
    slabPart("scale.foot", { x: postX - 2.4, y: postY - 2.4, w: 4.8, d: 4.8, r: 0.5 }, SEDIMENT_BOTTOM + 0.1, -SEDIMENT_BOTTOM + 0.9, projection, { tone: "mid", bias: 300 }),
    slabPart("scale.post", { x: postX - 1.1, y: postY - 1.1, w: 2.2, d: 2.2, r: 0.3 }, 1, depth + 3, projection, { tone: "mid", steps: 2, bias: 301, inner: `<path class="iso-line" data-tone="lo" d="${minor.join("")}"/><path class="iso-line" data-tone="hi" d="${major.join("")}"/>` }),
    postPart("scale.cap", [postX, postY], 1.4, depth + 4, 0.8, projection, { tone: "hi", bias: 302 }),
  ];
}

type StaticScene = {
  /** Layers of the stack, each painted far to near: under the seabed texture, the sliding texture, the water behind,
   * the hull below the water, the surface, and everything above it. */
  layers: { block: Part[]; texture: Part[]; waterBack: Part[]; hullUnder: Part[]; surface: Part[]; above: Part[]; front: Part[] };
  texturePeriod: number;
  seabedClip: string;
  waterClip: string;
  fadeFrom: Flat;
  fadeTo: Flat;
};

/** Every static part, once per figure world. */
export function buildStaticScene(view: FigureView): StaticScene {
  const { projection, depth } = view;
  const texture = buildSeabedTexture(view);
  const water = buildWater(view);
  const top = [
    [BLOCK.x, BLOCK.y],
    [BLOCK.x + BLOCK.w, BLOCK.y],
    [BLOCK.x + BLOCK.w, BLOCK.y + BLOCK.d],
    [BLOCK.x, BLOCK.y + BLOCK.d],
  ] as const;
  // The clip is the seabed face plus 12 m of water over its far edge, so stones and the cable there keep their tops.
  const lift = 12;
  const seabedClip = pathOf(
    [iso([top[0][0], top[0][1], lift], projection), iso([top[1][0], top[1][1], lift], projection), iso([top[1][0], top[1][1], 0], projection), iso([top[2][0], top[2][1], 0], projection), iso([top[3][0], top[3][1], 0], projection), iso([top[0][0], top[0][1], 0], projection)],
    true,
  );
  const boxPoints: Point3[] = [];
  for (const [alongX, acrossY] of top) for (const height of [0, depth]) boxPoints.push([alongX, acrossY, height]);
  const waterClip = pathOf(hullOf(boxPoints.map((point) => iso(point, projection))), true);
  return {
    layers: { block: buildBlock(view), texture: texture.parts, waterBack: water.back, hullUnder: buildHullUnderwater(view), surface: water.surface, above: buildShipAbove(view), front: [...water.front, ...buildScale(view)] },
    texturePeriod: texture.period,
    seabedClip,
    waterClip,
    fadeFrom: iso([BLOCK.x, 0, 0], projection),
    fadeTo: iso([BLOCK.x + BLOCK.w, 0, 0], projection),
  };
}
