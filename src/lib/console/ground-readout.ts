import { formatUtcClock } from "@/lib/replay/format-utc";
import type { ReplayCut } from "@/lib/replay/replay-scene";
import type { GroundReadout } from "@/lib/seabed/scene/director/viewer-port";

// The stage's hover readout as lines a reader takes in at a glance: the water there, the nearest cable (named as the
// case names it), and when the ship passed nearest, with how far off.

const METRES_PER_KM = 1000;

function formatDistance(distanceMetres: number): string {
  return distanceMetres < METRES_PER_KM ? `${Math.round(distanceMetres)} m` : `${(distanceMetres / METRES_PER_KM).toFixed(1)} km`;
}

export type GroundReadoutLine = { id: "depth" | "cable" | "ship"; text: string };

export function describeGroundReadout(readout: GroundReadout, cuts: readonly Pick<ReplayCut, "cableName" | "label">[]): GroundReadoutLine[] {
  const lines: GroundReadoutLine[] = [{ id: "depth", text: readout.waterDepthMetres === null ? "Land" : `${Math.round(readout.waterDepthMetres)} m of water` }];
  const cable = readout.nearestCable;
  if (cable) {
    const name = cuts.find((cut) => cut.cableName === cable.name)?.label ?? cable.name;
    lines.push({ id: "cable", text: `${name}, ${formatDistance(cable.distanceMetres)}` });
  }
  const pass = readout.shipPass;
  if (pass) lines.push({ id: "ship", text: `Ship nearest at ${formatUtcClock(pass.atMs)} UTC, ${formatDistance(pass.distanceMetres)} off` });
  return lines;
}
