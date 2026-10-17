import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// The Kattegat, the Belts and the Sound, the Baltic's only way to the ocean. Picked for slot 8 by measured coverage
// (scripts/regions/measure-coverage.ts, 40 frames of 17 Oct 2026), with the detector's egress budget deciding against
// the denser southern North Sea (docs/REGIONS.md).
export const DANISH_STRAITS_KATTEGAT: Region = {
  id: "danish-straits-kattegat",
  name: "Danish straits and Kattegat",
  box: { west: 9.5, east: 13.0, south: 54.3, north: 58.0 },
  timeZone: "Europe/Copenhagen",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: [],
  // Yi Peng 3 anchored in the Kattegat after the November 2024 cuts, under watch by Danish naval vessels.
  incidents: [{ name: "Yi Peng 3 held in the Kattegat after the BCS and C-Lion1 cuts", year: 2024, caseSlug: "yi-peng-3-2024" }],
  reason:
    "Picked by coverage: aisstream hears a median 164 ships in the box per frame and 10.9 positions a minute within 3 km of a cable (90th percentile 17.6; 40 frames, 17 Oct 2026), ahead of the Irish Sea (4.2) and the Red Sea, where aisstream heard no ship at all.",
};
