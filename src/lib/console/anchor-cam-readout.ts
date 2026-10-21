import type { ReplayCut } from "@/lib/replay/replay-scene";
import type { AnchorFacts } from "@/lib/seabed/scene/director/viewer-port";

// The anchor cam window's four figures (board 22): the water under the anchor, the chain paid out, the distance to the
// nearest cable named as the case names it, and the anchor's speed over the seabed.

/** `id` names the figure in test hooks (`data-testid` "anchor-cam-<id>"). */
export type AnchorReadout = { id: "depth" | "chain" | "cable" | "speed"; label: string; value: string; unit: string };

const METRES_PER_KM = 1000;

/** A distance in metres under a kilometre, in kilometres with two decimals above (board 22: "1.25 km"). */
function formatDistance(distanceMetres: number): { value: string; unit: string } {
  return distanceMetres < METRES_PER_KM ? { value: String(Math.round(distanceMetres)), unit: "m" } : { value: (distanceMetres / METRES_PER_KM).toFixed(2), unit: "km" };
}

export function describeAnchorReadouts(facts: AnchorFacts, cuts: readonly Pick<ReplayCut, "cableName" | "label">[]): AnchorReadout[] {
  const cable = facts.nearestCable;
  // The seabed file names a cable by its mapped route ("HVDC Estlink 2"); a cut cable reads as the case's label.
  const cableName = cable ? (cuts.find((cut) => cut.cableName === cable.name)?.label ?? cable.name) : null;
  const cableDistance = cable ? formatDistance(cable.distanceMetres) : null;
  return [
    { id: "depth", label: "Depth", value: facts.waterDepthMetres.toFixed(1), unit: "m" },
    { id: "chain", label: "Chain out", value: String(Math.round(facts.chainPaidOutMetres)), unit: "m" },
    cableName && cableDistance ? { id: "cable", label: `To ${cableName}`, ...cableDistance } : { id: "cable", label: "Nearest cable", value: "None", unit: "" },
    { id: "speed", label: "Over ground", value: facts.anchorSpeedKnots.toFixed(1), unit: "kn" },
  ];
}
