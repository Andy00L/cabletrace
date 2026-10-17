import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// Orkney, Shetland and the Faroe Islands: SHEFA-2 and the northern North Sea oil and gas pipelines.
export const NORTH_SEA_SHETLAND: Region = {
  id: "north-sea-shetland",
  name: "Shetland, Orkney and Faroe",
  box: { west: -8.0, east: 2.0, south: 57.5, north: 62.5 },
  timeZone: "Europe/London",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: [],
  incidents: [{ name: "SHEFA-2, a fishing vessel blamed", year: 2022, caseSlug: null }],
  reason:
    "Ranked fifth (ambition-pass 6.4): SHEFA-2 cut by a fishing vessel in 2022 and dense trawling over 166 seeded lines. aisstream hears a median 10 ships in the box per frame and 1.0 position a minute within 3 km of a cable (40 frames, 17 Oct 2026).",
};
