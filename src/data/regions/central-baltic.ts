import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// Öland, Gotland and the Latvian and Lithuanian coast, from Karlskrona to the Gulf of Finland box's south edge.
// Digitraffic's receivers reach into the north of this box but not its south (DIGITRAFFIC_BOX in
// src/lib/live/ship-merge.ts ends at 57.2 N), so the whole box is recorded from aisstream, one rule for the region.
export const CENTRAL_BALTIC: Region = {
  id: "central-baltic",
  name: "Central Baltic",
  box: { west: 15.2, east: 22.0, south: 54.8, north: 59.0 },
  timeZone: "Europe/Stockholm",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: ["baltic-proper", "gotland-latvia"],
  incidents: [
    { name: "BCS East-West Interlink and C-Lion1 (Yi Peng 3)", year: 2024, caseSlug: "yi-peng-3-2024" },
    { name: "Ventspils to Gotland fibre (Vezhen)", year: 2025, caseSlug: "vezhen-2025" },
    { name: "Sventoji to Liepaja cable", year: 2026, caseSlug: null },
  ],
  reason:
    "Ranked second (ambition-pass 6.4): three cable incidents since 2024, one of them the only real AIS drag on record (Yi Peng 3). aisstream hears a median 34 ships in the box per frame and 0.6 positions a minute within 3 km of a cable (40 frames, 17 Oct 2026): thin coverage, measured, not assumed.",
};
