import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// The Svalbard Undersea Cable System from Vesterålen to Longyearbyen (OpenStreetMap runs it west to 8 E), and the
// Lofoten and Vesterålen coast. BarentsWatch would add Norway's own AIS, but its OAuth client and licence are not set
// up (ambition-pass 6.1), so aisstream records it for now.
export const NORWAY_SVALBARD: Region = {
  id: "norway-svalbard",
  name: "Norway and Svalbard",
  box: { west: 7.5, east: 20.0, south: 68.5, north: 78.5 },
  timeZone: "Europe/Oslo",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: ["svalbard"],
  incidents: [{ name: "Svalbard cable, a trawler crossed it about 20 times (Space Norway)", year: 2022, caseSlug: "svalbard-2022" }],
  reason:
    "Ranked third (ambition-pass 6.4): the 2022 Svalbard cable damage and regular trawler crossings. aisstream hears a median 16 ships in the box per frame and none within 3 km of a cable (40 frames, 17 Oct 2026); BarentsWatch is the feed that would fill it.",
};
