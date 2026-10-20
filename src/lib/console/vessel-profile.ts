import type { ChainState } from "@/lib/detection/anchor-model";
import type { ReplaySceneInput, ShipKind } from "@/lib/replay/replay-scene";
import { estimateCaseShipChain, readChainSpan, shapeCatenary } from "@/lib/ships/anchor-chain";
import { SHIP_SPECS, type ShipSpec } from "@/lib/ships/ship-specs";

// The vessel inspector's side profile (style board, board 23): the case ship drawn from its type's proportions
// (src/lib/ships/ship-specs.ts), its anchor at the hawse stowed, let go or dragging, and the chain paid out and the
// layback drawn to the same scale as the hull and the water. The chain is the detector's own model
// (src/lib/ships/anchor-chain.ts), the one the 3D view hangs its chain from, so the drawing and the scene agree.
// Pure geometry: no React, no three.js. The 3D ship builder (src/lib/ships/build-ship.ts, ship-parts.ts) places the
// same superstructure; its helpers need three.js, so the few placement ratios are restated here with their sourceRef.

/** What the anchor does at a replay moment, and why when the chain cannot be laid on the seabed. */
export type AnchorReading =
  | { state: "stowed" }
  | { state: "let-go"; reason: "depth-unknown" | "deeper-than-chain" }
  | { state: "dragging"; depthMetres: number; laybackMetres: number; heightMetres: number };

export type AnchorState = AnchorReading["state"];

export type VesselAnchor = {
  reading: AnchorReading;
  chain: ChainState;
  /** The length the hull is drawn at: the case's length, or the anchor model's assumed ship when none is reported. */
  drawnLengthMetres: number;
  isLengthAssumed: boolean;
};

// The ship the anchor model assumes when no length is reported: sourceRef src/lib/detection/anchor-model.ts,
// UNKNOWN_LENGTH_NOMINAL_METRES (its band spans 120 to 300 m ships and the model states it in `assumptions`).
export const ASSUMED_LENGTH_METRES = 200;

/** True inside the case's drag window: the 3D view lays the anchor and its chain only then (overview.ts, update). */
export function isInDragWindow(dragWindow: ReplaySceneInput["dragWindow"], atMs: number): boolean {
  return dragWindow !== null && atMs >= dragWindow.startMs && atMs <= dragWindow.endMs;
}

/**
 * The anchor as the 3D view draws it (src/lib/seabed/scene/overview.ts, update): down only inside the drag window,
 * laid on the seabed when the water depth under the ship is known and the chain reaches it.
 */
export function readVesselAnchor(input: { kind: ShipKind; lengthMetres: number | null; isAnchorDown: boolean; depthMetres: number | null }): VesselAnchor {
  const isLengthAssumed = input.lengthMetres === null || !Number.isFinite(input.lengthMetres) || input.lengthMetres <= 0;
  // A length of 0 makes the anchor model fall back to its assumed ship and its 120 to 300 m band.
  const chain = estimateCaseShipChain(input.kind, isLengthAssumed ? 0 : (input.lengthMetres ?? 0));
  const drawnLengthMetres = isLengthAssumed ? ASSUMED_LENGTH_METRES : (input.lengthMetres ?? ASSUMED_LENGTH_METRES);
  const { isAnchorDown, depthMetres } = input;
  if (!isAnchorDown) return { reading: { state: "stowed" }, chain, drawnLengthMetres, isLengthAssumed };
  if (depthMetres === null || !(depthMetres > 0)) return { reading: { state: "let-go", reason: "depth-unknown" }, chain, drawnLengthMetres, isLengthAssumed };
  const span = readChainSpan(chain, -depthMetres);
  if (!span) return { reading: { state: "let-go", reason: "deeper-than-chain" }, chain, drawnLengthMetres, isLengthAssumed };
  return { reading: { state: "dragging", depthMetres, ...span }, chain, drawnLengthMetres, isLengthAssumed };
}

type Point = { x: number; y: number };

/** Fill roles, coloured by the component from the tokens: hull and structure in ink, cargo faint, windows page. */
export type ProfileShapeRole = "hull" | "structure" | "cargo" | "funnel" | "window";
export type ProfileLineRole = "rig" | "waterline";

export type VesselProfile = {
  widthPx: number;
  heightPx: number;
  pxPerMetre: number;
  surfaceY: number;
  /** Null unless the anchor lies on the seabed: only then is the water column drawn to its floor. */
  seabedY: number | null;
  shapes: { role: ProfileShapeRole; d: string }[];
  lines: { role: ProfileLineRole; d: string }[];
  sternX: number;
  bowX: number;
  hawse: Point;
  /** Where the anchor glyph sits: in the hawse when stowed, at the chain's end otherwise. */
  anchorPoint: Point;
  /** The chain from the hawse to the anchor; null while stowed. */
  chain: { d: string; lengthPx: number; labelPoint: Point } | null;
};

// Room kept around the drawing (px): the anchor glyph on the left, the depth bracket on the right, the anchor's label
// under the seabed, and the hanging chain of an anchor let go.
const PAD_TOP_PX = 4;
const PAD_LEFT_PX = 10;
const PAD_RIGHT_PX = 16;
const PAD_BOTTOM_STOWED_PX = 6;
const PAD_BOTTOM_DRAGGING_PX = 22;
const PAD_BOTTOM_LET_GO_PX = 40;
const CHAIN_POINT_COUNT = 48;

// Superstructure placement, restated from the 3D builder (sourceRef src/lib/ships/ship-parts.ts readBridgeFrontX,
// readTierHeight, addAccommodationBlock, addFunnel; src/lib/ships/build-ship.ts addSuperstructure), as shares of the
// length measured from the stern instead of the hull's midpoint.
const FULL_TIER_LENGTH_METRES = 160;
const SMALL_CRAFT_LENGTH_METRES = 60;
const BRIDGE_FRONT_SHARE = { aft: 0.149, forward: 0.81, midship: 0.64, "full-length": 0.86 } as const;
// The hawse pipe sits 9 m aft of the stem on a 228 m ship (sourceRef src/lib/ships/ship-parts.ts readHawsePoint).
const HAWSE_AFT_OF_STEM_METRES = 9;
const REFERENCE_LENGTH_METRES = 228;

type ShipDrawing = {
  polygons: { role: ProfileShapeRole; points: Point[] }[];
  polylines: { role: ProfileLineRole; points: Point[] }[];
  hawse: Point;
  topMetres: number;
  keelMetres: number;
};

function rectangle(role: ProfileShapeRole, fromX: number, fromY: number, toX: number, toY: number) {
  return { role, points: [{ x: fromX, y: fromY }, { x: toX, y: fromY }, { x: toX, y: toY }, { x: fromX, y: toY }] };
}

function circle(role: ProfileShapeRole, center: Point, radius: number) {
  return { role, points: Array.from({ length: 20 }, (_slot, index) => ({ x: center.x + radius * Math.cos((index / 20) * 2 * Math.PI), y: center.y + radius * Math.sin((index / 20) * 2 * Math.PI) })) };
}

/** Accommodation tiers above the deck, as the 3D builder counts them (fewer on merchant hulls under 160 m). */
function countTiers(spec: ShipSpec, lengthMetres: number): number {
  const isMerchantLayout = spec.superstructure === "aft" || spec.superstructure === "full-length";
  return isMerchantLayout ? Math.max(1, Math.round(spec.superstructureTiers * Math.min(1, Math.max(0.5, lengthMetres / FULL_TIER_LENGTH_METRES)))) : spec.superstructureTiers;
}

/** The ship in metres: x from the stern (0) to the stem (the length overall), y up from the waterline. */
function drawShip(kind: ShipKind, lengthMetres: number, hawseHeightMetres: number): ShipDrawing {
  const spec = SHIP_SPECS[kind];
  const length = lengthMetres;
  const along = length / REFERENCE_LENGTH_METRES;
  const fitting = Math.max(0.35, Math.min(1, along));
  const depth = spec.depthToLength * length;
  const draught = spec.draughtToLength * length;
  const freeboard = depth - draught;
  const forecastleRise = spec.forecastleRiseToDepth * depth;
  const bowDeck = freeboard + forecastleRise;
  const rakeOverhang = spec.stemRakeToDepth * depth * ((depth + forecastleRise) / depth);
  const stemFootX = length - rakeOverhang;
  const stemXAt = (heightMetres: number) => stemFootX + (rakeOverhang * (heightMetres + draught)) / (bowDeck + draught);
  const polygons: ShipDrawing["polygons"] = [];
  const polylines: ShipDrawing["polylines"] = [];

  // Hull: transom and counter at the stern, a flat keel, the bulb (if the type has one), the raked stem, the
  // forecastle rising over the last tenth of the length.
  const hull: Point[] = [
    { x: 0, y: freeboard },
    { x: 0.006 * length, y: 0.2 * freeboard },
    { x: 0.03 * length, y: -0.35 * draught },
    { x: 0.05 * length, y: -draught },
  ];
  const bulbRadius = spec.bulbToBeam * spec.beamToLength * length;
  if (bulbRadius > 0) {
    // Bulb centre 0.42 of the draught above the keel and its nose 1.44 radii ahead of the stem foot (hull-form.ts).
    const noseX = stemFootX + 1.44 * bulbRadius;
    const centerX = noseX - bulbRadius;
    const centerY = -draught + 0.42 * draught;
    hull.push({ x: centerX, y: -draught });
    for (let step = 1; step <= 6; step += 1) {
      const angle = -Math.PI / 2 + (step / 6) * Math.PI;
      const verticalRadius = angle < 0 ? 0.42 * draught : bulbRadius;
      hull.push({ x: centerX + bulbRadius * Math.cos(angle), y: centerY + verticalRadius * Math.sin(angle) });
    }
    const joinY = centerY + bulbRadius;
    hull.push({ x: Math.max(stemXAt(joinY), centerX), y: joinY });
  } else {
    hull.push({ x: stemFootX, y: -draught });
  }
  hull.push({ x: length, y: bowDeck }, { x: 0.93 * length, y: bowDeck }, { x: 0.9 * length, y: freeboard });
  polygons.push({ role: "hull", points: hull });
  polylines.push({ role: "waterline", points: [{ x: 0.012 * length, y: 0 }, { x: stemXAt(0), y: 0 }] });

  // Superstructure: stepped tiers, the bridge a little aft of their front with its window band, the mast, the funnel.
  const tierHeight = length < SMALL_CRAFT_LENGTH_METRES ? 2.5 : 2.9;
  const tiers = countTiers(spec, length);
  const frontX = BRIDGE_FRONT_SHARE[spec.superstructure] * length;
  const isRoRo = kind === "ro-ro";
  const vehicleDeckHeight = 0.12 * length;
  const blockLength = { aft: 0.075, forward: 0.2, midship: 0.26, "full-length": isRoRo ? 0.1 : 0.72 }[spec.superstructure] * length;
  const baseY = isRoRo ? freeboard + vehicleDeckHeight : freeboard;
  if (isRoRo) polygons.push(rectangle("structure", 0.005 * length, freeboard - 0.5, 0.87 * length, baseY));
  for (let tier = 0; tier < tiers; tier += 1) {
    polygons.push(rectangle("structure", frontX - blockLength * (1 - tier * 0.07), baseY + tier * tierHeight, frontX, baseY + (tier + 1) * tierHeight - 0.15));
  }
  const bridgeDepth = Math.max(4, 0.53 * blockLength);
  const bridgeBottom = baseY + tiers * tierHeight;
  const bridgeTop = bridgeBottom + 1.03 * tierHeight;
  const bridgeAft = frontX - 0.5 - bridgeDepth;
  polygons.push(rectangle("structure", bridgeAft, bridgeBottom, frontX - 0.5, bridgeTop));
  const paneCount = Math.max(2, Math.floor(bridgeDepth / 2.4));
  const panePitch = (bridgeDepth - 1.2) / paneCount;
  for (let pane = 0; pane < paneCount; pane += 1) {
    const paneX = bridgeAft + 0.6 + pane * panePitch;
    polygons.push(rectangle("window", paneX + 0.15 * panePitch, bridgeBottom + 0.45 * tierHeight, paneX + 0.75 * panePitch, bridgeBottom + 0.78 * tierHeight));
  }
  const mastX = frontX - 0.6 * bridgeDepth;
  const mastTop = bridgeTop + Math.max(4, 0.04 * length);
  polylines.push({ role: "rig", points: [{ x: mastX, y: bridgeTop }, { x: mastX, y: mastTop }] });
  const funnel =
    spec.superstructure === "full-length"
      ? { x: isRoRo ? 0.225 * length : 0.35 * length, base: isRoRo ? baseY : bridgeBottom }
      : { x: frontX - { aft: 0.092, forward: 0.24, midship: 0.3 }[spec.superstructure] * length, base: baseY };
  const casingHeight = 12 * Math.min(1, along);
  const funnelHeight = 10 * Math.max(Math.min(1, along), 0.45);
  const casingHalf = (8 * Math.min(1, along) + 2) / 2;
  const funnelHalf = (7 * Math.min(1, along) + 1.5) / 2;
  // Raked aft by 0.08 rad, as the 3D funnel.
  const rake = Math.tan(0.08) * funnelHeight;
  polygons.push(rectangle("structure", funnel.x - casingHalf, funnel.base, funnel.x + casingHalf, funnel.base + casingHeight));
  const funnelBase = funnel.base + casingHeight;
  polygons.push({
    role: "funnel",
    points: [
      { x: funnel.x - funnelHalf, y: funnelBase },
      { x: funnel.x + funnelHalf, y: funnelBase },
      { x: funnel.x + funnelHalf - rake, y: funnelBase + funnelHeight },
      { x: funnel.x - funnelHalf - rake, y: funnelBase + funnelHeight },
    ],
  });

  // Holds, tanks or the type's own gear on deck, on the stretch the superstructure leaves (build-ship.ts cargo span).
  const cargoSpan =
    spec.superstructure === "aft"
      ? { start: frontX + 0.012 * length, end: 0.9 * length - 0.013 * length }
      : spec.superstructure === "forward"
        ? { start: 0.15 * length, end: frontX - 0.28 * length }
        : spec.superstructure === "midship"
          ? { start: 0, end: frontX - 0.3 * length }
          : { start: 0, end: frontX };
  const cargoLength = cargoSpan.end - cargoSpan.start;
  switch (kind) {
    case "bulk-carrier": {
      const hatchCount = Math.max(3, Math.round(7 * along));
      const pitch = cargoLength / hatchCount;
      for (let hold = 0; hold < hatchCount; hold += 1) {
        const centerX = cargoSpan.start + pitch * (hold + 0.5);
        polygons.push(rectangle("cargo", centerX - 0.36 * pitch, freeboard, centerX + 0.36 * pitch, freeboard + 2.6));
      }
      break;
    }
    case "general-cargo": {
      const pitch = cargoLength / 3;
      for (let hold = 0; hold < 3; hold += 1) {
        const aftX = cargoSpan.start + hold * pitch + 2 * along;
        polygons.push(rectangle("cargo", aftX, freeboard, aftX + pitch - 6 * along, freeboard + 2.3));
      }
      for (const [craneX, direction] of [[cargoSpan.start + pitch, 1], [cargoSpan.start + 2 * pitch, -1]] as const) {
        const pedestalTop = freeboard + 9 * along;
        polygons.push(rectangle("structure", craneX - 1.7 * along, freeboard, craneX + 1.7 * along, pedestalTop));
        const jibLength = 26 * along;
        polylines.push({ role: "rig", points: [{ x: craneX, y: pedestalTop + 1.2 * along }, { x: craneX + direction * jibLength * Math.cos(0.16), y: pedestalTop + 1.2 * along - jibLength * Math.sin(0.16) }] });
      }
      break;
    }
    case "container-ship": {
      // 40 ft bays (12.2 m) with 1.4 m lashing gaps and 2.59 m tiers (ISO 668), four high aft, lower toward the bow.
      const bayCount = Math.floor(cargoLength / 13.6);
      for (let bay = 0; bay < bayCount; bay += 1) {
        const aftX = cargoSpan.start + bay * 13.6;
        const bowAmount = Math.min(1, Math.max(0, (aftX + 6.1 - 0.63 * length) / (cargoSpan.end - 0.63 * length)));
        const tiersHigh = bowAmount > 0.55 ? 2 : bowAmount > 0 ? 3 : 4;
        polygons.push(rectangle("cargo", aftX, freeboard, aftX + 12.2, freeboard + 1.2 + tiersHigh * 2.59));
      }
      break;
    }
    case "tanker": {
      polylines.push({ role: "rig", points: [{ x: cargoSpan.start, y: freeboard + 1.4 }, { x: cargoSpan.end, y: freeboard + 1.4 }] });
      for (let domeX = cargoSpan.start + 8 * along; domeX < cargoSpan.end - 6 * along; domeX += 17 * along) {
        polygons.push(rectangle("cargo", domeX - 0.9 * along, freeboard, domeX + 0.9 * along, freeboard + 0.8));
      }
      const craneX = 0.5 * length + 4.5 * along;
      polygons.push(rectangle("structure", craneX - 0.55, freeboard, craneX + 0.55, freeboard + 8 * along));
      polylines.push({ role: "rig", points: [{ x: craneX, y: freeboard + 8 * along }, { x: craneX - 15 * along * Math.cos(0.45), y: freeboard + 8 * along + 15 * along * Math.sin(0.45) }] });
      break;
    }
    case "fishing": {
      const gantryTop = freeboard + 0.55 * depth + 3;
      polylines.push({ role: "rig", points: [{ x: 0.04 * length, y: freeboard }, { x: 0.02 * length, y: gantryTop }, { x: 0.06 * length, y: gantryTop }] });
      polygons.push(rectangle("cargo", 0.2 * length, freeboard, 0.24 * length, freeboard + 2));
      const foreMastX = 0.59 * length;
      polylines.push({ role: "rig", points: [{ x: foreMastX, y: freeboard }, { x: foreMastX, y: freeboard + 0.7 * depth + 5 }, { x: foreMastX - 0.22 * length, y: freeboard + 0.7 * depth + 1 }] });
      break;
    }
    case "tug": {
      polygons.push(rectangle("cargo", 0.28 * length, freeboard, 0.32 * length, freeboard + 1.9));
      polylines.push({ role: "rig", points: [{ x: 0.13 * length, y: freeboard }, { x: 0.13 * length, y: freeboard + 3.2 }, { x: 0.17 * length, y: freeboard + 3.2 }, { x: 0.17 * length, y: freeboard }] });
      break;
    }
    case "ro-ro": {
      for (let ventX = 0.02 * length + 10; ventX < 0.87 * length - 8; ventX += 14) polygons.push(rectangle("cargo", ventX - 1.2, baseY, ventX + 1.2, baseY + 1.6));
      break;
    }
    case "passenger": {
      const boatLength = Math.min(11, 0.05 * length + 2);
      const boatDeck = freeboard + 3 * tierHeight + 1.2;
      for (let boatX = 0.25 * length; boatX < 0.72 * length; boatX += boatLength * 1.6) {
        polygons.push(rectangle("cargo", boatX - boatLength / 2, boatDeck - 0.17 * boatLength, boatX + boatLength / 2, boatDeck + 0.17 * boatLength));
      }
      break;
    }
    case "cable-layer": {
      const sheaveRadius = 0.022 * length + 1.2;
      polygons.push(circle("cargo", { x: length - 0.2 * sheaveRadius, y: bowDeck + 0.2 * sheaveRadius }, sheaveRadius));
      polylines.push({ role: "rig", points: [{ x: 0.04 * length, y: freeboard }, { x: 0.01 * length, y: freeboard + 0.5 * depth + 6 }] });
      const tankRadius = Math.min(0.32 * spec.beamToLength * length, 8);
      for (const tankX of [0.375 * length, 0.575 * length]) polygons.push(rectangle("cargo", tankX - tankRadius, freeboard, tankX + tankRadius, freeboard + 2.4));
      break;
    }
    default: {
      const unhandledKind: never = kind;
      return unhandledKind;
    }
  }

  const hawseY = Math.min(hawseHeightMetres, bowDeck - 0.5);
  const hawse = { x: stemXAt(hawseY) - HAWSE_AFT_OF_STEM_METRES * fitting, y: hawseY };
  const allPoints = [...polygons.flatMap((polygon) => polygon.points), ...polylines.flatMap((polyline) => polyline.points)];
  return { polygons, polylines, hawse, topMetres: Math.max(...allPoints.map((point) => point.y)), keelMetres: -draught };
}

function toPathData(points: readonly Point[], isClosed: boolean): string {
  const commands = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join("");
  return isClosed ? `${commands}Z` : commands;
}

function measurePolyline(points: readonly Point[]): number {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return previous ? total + Math.hypot(point.x - previous.x, point.y - previous.y) : total;
  }, 0);
}

/**
 * The side profile in a box of `widthPx` by `heightPx` CSS px, at one scale for length and height: the hull, the
 * water and the chain all read in the same metres. While the anchor drags, the box spans from the anchor to the bow
 * and from the masthead to the seabed; otherwise it frames the ship alone.
 */
export function buildVesselProfile(input: { kind: ShipKind; anchor: VesselAnchor; widthPx: number; heightPx: number }): VesselProfile {
  const { kind, anchor, widthPx, heightPx } = input;
  const { reading, chain } = anchor;
  const drawing = drawShip(kind, anchor.drawnLengthMetres, chain.hawseAboveWaterMetres);
  const lengthMetres = anchor.drawnLengthMetres;
  const anchorAlongMetres = reading.state === "dragging" ? drawing.hawse.x - reading.laybackMetres : 0;
  const leftMetres = Math.min(0, anchorAlongMetres);
  const bottomMetres = reading.state === "dragging" ? -reading.depthMetres : drawing.keelMetres;
  const padBottom = reading.state === "dragging" ? PAD_BOTTOM_DRAGGING_PX : reading.state === "let-go" ? PAD_BOTTOM_LET_GO_PX : PAD_BOTTOM_STOWED_PX;
  const usableWidth = Math.max(1, widthPx - PAD_LEFT_PX - PAD_RIGHT_PX);
  const usableHeight = Math.max(1, heightPx - PAD_TOP_PX - padBottom);
  const pxPerMetre = Math.min(usableWidth / (lengthMetres - leftMetres), usableHeight / (drawing.topMetres - bottomMetres));
  // The bow sits at the right edge while a chain trails behind it; a ship alone is centred.
  const spareWidth = usableWidth - (lengthMetres - leftMetres) * pxPerMetre;
  const originX = reading.state === "dragging" ? widthPx - PAD_RIGHT_PX - lengthMetres * pxPerMetre : PAD_LEFT_PX + spareWidth / 2;
  const surfaceY = PAD_TOP_PX + drawing.topMetres * pxPerMetre;
  const toPx = (point: Point): Point => ({ x: originX + point.x * pxPerMetre, y: surfaceY - point.y * pxPerMetre });
  const hawse = toPx(drawing.hawse);

  let seabedY: number | null = null;
  let anchorPoint = hawse;
  let chainView: VesselProfile["chain"] = null;
  if (reading.state === "dragging") {
    seabedY = surfaceY + reading.depthMetres * pxPerMetre;
    const shape = shapeCatenary({ paidOutMetres: chain.nominalPaidOutMetres, heightMetres: reading.heightMetres, laybackMetres: reading.laybackMetres, pointCount: CHAIN_POINT_COUNT });
    anchorPoint = { x: hawse.x - reading.laybackMetres * pxPerMetre, y: seabedY };
    // The catenary is the model's, for its hawse height; it is laid between the drawn hawse and the seabed, as the 3D
    // view lays it between its drawn hawse and the anchor.
    const riseToDrawnHawse = seabedY - hawse.y;
    const points = shape.ok
      ? shape.value.points.map((point) => ({ x: anchorPoint.x + point.alongMetres * pxPerMetre, y: anchorPoint.y - (point.upMetres / reading.heightMetres) * riseToDrawnHawse }))
      : [anchorPoint, hawse];
    const grounded = shape.ok ? shape.value.groundedMetres : 0;
    chainView = { d: toPathData(points, false), lengthPx: measurePolyline(points), labelPoint: { x: anchorPoint.x + Math.max(grounded * pxPerMetre * 0.5, 40), y: seabedY - 6 } };
  } else if (reading.state === "let-go") {
    // The anchor hangs from the hawse; the seabed under it is unknown or out of the chain's reach.
    anchorPoint = { x: hawse.x, y: heightPx - 12 };
    chainView = { d: toPathData([hawse, anchorPoint], false), lengthPx: anchorPoint.y - hawse.y, labelPoint: { x: hawse.x - 6, y: (hawse.y + anchorPoint.y) / 2 + 12 } };
  }

  // A stowed anchor needs no water column: the box shrinks to the ship, so the card does not carry an empty band.
  const drawnHeightPx = reading.state === "stowed" ? Math.min(heightPx, Math.ceil(PAD_TOP_PX + (drawing.topMetres - bottomMetres) * pxPerMetre + padBottom)) : heightPx;
  return {
    widthPx,
    heightPx: drawnHeightPx,
    pxPerMetre,
    surfaceY,
    seabedY,
    shapes: drawing.polygons.map((polygon) => ({ role: polygon.role, d: toPathData(polygon.points.map(toPx), true) })),
    lines: drawing.polylines.map((polyline) => ({ role: polyline.role, d: toPathData(polyline.points.map(toPx), false) })),
    sternX: originX,
    bowX: originX + lengthMetres * pxPerMetre,
    hawse,
    anchorPoint,
    chain: chainView,
  };
}
