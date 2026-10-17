import { computeLayback, estimateAnchorModel, type ChainState } from "@/lib/detection/anchor-model";
import type { ShipKind } from "@/lib/replay/replay-scene";
import type { Result } from "@/lib/result";

// Where the anchor lies and how its chain hangs, for the 3D replay. The physics is the detector's own
// (src/lib/detection/anchor-model.ts: the ship's anchoring equipment from IACS UR A1 and the catenary layback for the
// depth); this file only turns its answer into a drawable shape, so the replay and the detector cannot disagree on
// where the anchor was. No three.js here.

/**
 * The AIS ship type code a case ship of each kind would send (ITU-R M.1371-5, Annex 8, Table 53: 30 fishing,
 * 52 tug, 60 passenger, 70 cargo, 80 tanker). The anchor model reads it for the hull's block coefficient only; a cable
 * layer has no code of its own (it reports 33, dredging or underwater operations, or 90 to 99) and takes the default.
 */
const AIS_TYPE_BY_KIND: Record<ShipKind, number | null> = {
  tanker: 80,
  "bulk-carrier": 70,
  "general-cargo": 70,
  "container-ship": 70,
  "ro-ro": 70,
  fishing: 30,
  tug: 52,
  passenger: 60,
  "cable-layer": null,
};

/** The anchoring equipment the detector assumes for a case ship of this kind and length. */
export function estimateCaseShipChain(kind: ShipKind, lengthMetres: number): ChainState {
  return estimateAnchorModel({ lengthMetres, beamMetres: null, draughtMetres: null, shipType: AIS_TYPE_BY_KIND[kind], antennaFromBowMetres: null });
}

/** Layback (m, hawse to anchor along the ground) and hawse height above the seabed (m) at a seabed elevation, or null. */
export function readChainSpan(model: ChainState, seabedElevationMetres: number): { laybackMetres: number; heightMetres: number } | null {
  const layback = computeLayback(model, seabedElevationMetres);
  if (!layback || layback.depthMetres === null) return null;
  return { laybackMetres: layback.nominalMetres, heightMetres: layback.depthMetres + model.hawseAboveWaterMetres };
}

/** A point of the chain: metres from the anchor along the ground toward the ship, and metres above the seabed. */
export type ChainPoint = { alongMetres: number; upMetres: number };

export type ChainShape = { points: ChainPoint[]; groundedMetres: number; suspendedMetres: number };

function measureSuspended(heightMetres: number, parameterMetres: number): number {
  return Math.sqrt(heightMetres * heightMetres + 2 * heightMetres * parameterMetres);
}

/** Horizontal span from anchor to hawse for a catenary parameter (m), the chain's grounded part lying straight. */
function measureSpan(paidOutMetres: number, heightMetres: number, parameterMetres: number): number {
  const suspended = Math.min(paidOutMetres, measureSuspended(heightMetres, parameterMetres));
  return paidOutMetres - suspended + parameterMetres * Math.asinh(suspended / parameterMetres);
}

/**
 * The chain from the anchor to the hawse as `pointCount` points: lying on the seabed for its grounded length, then
 * hanging as a catenary y = a (cosh(x / a) - 1) up to the hawse. The catenary parameter a is the one that gives the
 * detector's layback for this paid-out length and height (found by bisection: the span grows with a, from the slack
 * L - H to the taut sqrt(L^2 - H^2)); a layback outside that range is held to its nearest end.
 */
export function shapeCatenary(input: { paidOutMetres: number; heightMetres: number; laybackMetres: number; pointCount: number }): Result<ChainShape> {
  const { paidOutMetres, heightMetres, laybackMetres, pointCount } = input;
  if (!(heightMetres > 0) || !(paidOutMetres > heightMetres) || pointCount < 3) return { ok: false, reason: "the chain does not reach the seabed" };
  // The parameter at which the whole chain just hangs (no chain on the ground): the taut end of the range.
  let highParameter = (paidOutMetres * paidOutMetres - heightMetres * heightMetres) / (2 * heightMetres);
  let lowParameter = 1e-6;
  const targetSpan = Math.min(Math.max(laybackMetres, measureSpan(paidOutMetres, heightMetres, lowParameter)), measureSpan(paidOutMetres, heightMetres, highParameter));
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (lowParameter + highParameter) / 2;
    if (measureSpan(paidOutMetres, heightMetres, middle) < targetSpan) lowParameter = middle;
    else highParameter = middle;
  }
  const parameterMetres = (lowParameter + highParameter) / 2;
  const suspendedMetres = Math.min(paidOutMetres, measureSuspended(heightMetres, parameterMetres));
  const groundedMetres = paidOutMetres - suspendedMetres;
  const hangingSpan = parameterMetres * Math.asinh(suspendedMetres / parameterMetres);
  // A quarter of the points on the ground (two at least), the rest along the hanging part where the shape bends.
  const groundCount = Math.max(2, Math.round(pointCount / 4));
  const points: ChainPoint[] = [];
  for (let index = 0; index < groundCount; index += 1) points.push({ alongMetres: (groundedMetres * index) / groundCount, upMetres: 0 });
  const hangingCount = pointCount - groundCount;
  for (let index = 0; index < hangingCount; index += 1) {
    const horizontal = (hangingSpan * index) / (hangingCount - 1);
    points.push({ alongMetres: groundedMetres + horizontal, upMetres: parameterMetres * (Math.cosh(horizontal / parameterMetres) - 1) });
  }
  return { ok: true, value: { points, groundedMetres, suspendedMetres } };
}
