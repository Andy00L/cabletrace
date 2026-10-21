import type { BoundingBox } from "@/lib/regions/region";

// The /live globe's zoom tiers (plan/prompts/world-watch.md section 2, chosen by Andy on 20 Oct 2026): zoom by sea, not
// by land. One camera, four tiers: the Planet (ship density, busiest seas), a Sea (ships as dots, its watched regions),
// a Strait (a watched region's ships up close), and the Ship (the selected ship). The first three follow the camera's
// distance; the Ship tier is the camera following a picked ship (GlobeViewer.followShip).

export type GlobeTier = "planet" | "sea" | "strait" | "ship";
export type DistanceTier = Exclude<GlobeTier, "ship">;

export const GLOBE_TIERS: readonly GlobeTier[] = ["planet", "sea", "strait", "ship"];

/** Camera distances from the globe's centre (Earth radii) where each tier begins as the camera closes in. */
const SEA_BELOW_DISTANCE = 2.0;
const STRAIT_BELOW_DISTANCE = 1.18;

/**
 * Where the ladder flies the camera for each tier (Earth radii from the centre). Planet is the opening view. A sea
 * (the Baltic is about 1,500 km across) fills the stage at 1.45 with the 28 degree field of view; a watched region
 * (the Gulf of Finland is 470 km) at 1.1.
 */
export const TIER_CAMERA_DISTANCE: Readonly<Record<DistanceTier, number>> = { planet: 3.6, sea: 1.45, strait: 1.1 };

/** The Ship tier flies this close to the picked ship, about 250 km up, and the camera comes no closer anywhere. */
export const SHIP_TIER_DISTANCE = 1.04;

/** The density field and the ship dots cross over between these distances, so neither pops. */
const CROSSOVER_NEAR_DISTANCE = 1.8;
const CROSSOVER_FAR_DISTANCE = 2.3;

export function readDistanceTier(distance: number): DistanceTier {
  if (distance >= SEA_BELOW_DISTANCE) return "planet";
  if (distance >= STRAIT_BELOW_DISTANCE) return "sea";
  return "strait";
}

/** How much of the Planet tier's density field shows at a distance, 0 to 1 (smoothstep); the ship dots show the rest. */
export function readPlanetShare(distance: number): number {
  const amount = Math.min(1, Math.max(0, (distance - CROSSOVER_NEAR_DISTANCE) / (CROSSOVER_FAR_DISTANCE - CROSSOVER_NEAR_DISTANCE)));
  return amount * amount * (3 - 2 * amount);
}

export function isGlobeTier(value: string | null): value is GlobeTier {
  return GLOBE_TIERS.some((tier) => tier === value);
}

export const TIER_LABELS: Readonly<Record<GlobeTier, string>> = { planet: "Planet", sea: "Sea", strait: "Strait", ship: "Ship" };

/** Why a press on Ship did not fly: no ship is picked, or the frames on screen at that minute do not hold it. */
export type ShipTierRefusal = { kind: "no-ship" } | { kind: "not-in-frames"; mmsi: number; minuteLabel: string };

type ShipTierNoteInput = { refusal: ShipTierRefusal | null; selectedMmsi: number | null; minuteLabel: string; shipName: string };

/**
 * What the stage says after a press on Ship that could not fly, or null once it no longer holds: "no ship" until one
 * is picked, "not in the frames" while the same ship stays picked at the same minute.
 */
export function describeShipTierRefusal({ refusal, selectedMmsi, minuteLabel, shipName }: ShipTierNoteInput): string | null {
  if (refusal === null) return null;
  switch (refusal.kind) {
    case "no-ship":
      return selectedMmsi === null ? "Pick a ship first: zoom to a sea and click its dot, or pick one in the rail." : null;
    case "not-in-frames":
      return refusal.mmsi === selectedMmsi && refusal.minuteLabel === minuteLabel
        ? `${shipName} is not in the frames at ${minuteLabel} UTC. Move the timeline to a moment a feed heard it.`
        : null;
    default: {
      const unhandled: never = refusal;
      return unhandled;
    }
  }
}

/** A watched region as the browser gets it: outlined from the Sea tier down, and the Strait tier's place name. */
export type WatchedRegionOutline = { id: string; name: string; box: BoundingBox };
