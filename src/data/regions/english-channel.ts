import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// The eastern Channel and the Strait of Dover, from west of the Isle of Wight to Dunkirk. Picked for slot 7 by measured
// coverage (scripts/regions/measure-coverage.ts, 40 frames of 17 Oct 2026): the second-densest near-cable traffic
// aisstream hears of the candidates.
export const ENGLISH_CHANNEL: Region = {
  id: "english-channel",
  name: "English Channel and Dover Strait",
  box: { west: -2.0, east: 2.0, south: 49.5, north: 51.5 },
  timeZone: "Europe/London",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: [],
  incidents: [],
  reason:
    "Picked by coverage: aisstream hears a median 121 ships in the box per frame and 31.3 positions a minute within 3 km of a cable (90th percentile 43.4; 40 frames, 17 Oct 2026), the densest candidate after the southern North Sea, which the egress budget rules out (64.6 a minute).",
};
