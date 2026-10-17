import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// Taiwan, Penghu, Kinmen and Matsu. No open route dataset exists for Taiwan's cables (ambition-pass 6.4); the seed is
// what OpenStreetMap maps, and docs/REGIONS.md lists the cables of the incidents it lacks.
export const TAIWAN_STRAIT: Region = {
  id: "taiwan-strait",
  name: "Taiwan Strait",
  box: { west: 118.0, east: 122.5, south: 21.5, north: 26.5 },
  timeZone: "Asia/Taipei",
  liveSources: ["aisstream"],
  lineSources: ["openstreetmap"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: [],
  incidents: [
    { name: "Taiwan-Matsu No. 2 and No. 3", year: 2023, caseSlug: null },
    { name: "TPE and TPKM-3 off Keelung (Shunxin 39)", year: 2025, caseSlug: null },
    { name: "Taiwan-Penghu No. 3 (Hong Tai 58)", year: 2025, caseSlug: null },
    { name: "Taiwan-Matsu No. 3 off Dongyin (Hai Hong Gong 66)", year: 2026, caseSlug: null },
  ],
  reason:
    "Ranked fourth (ambition-pass 6.4): five ship-caused cable cases since 2023, one with a final conviction (Hong Tai 58). aisstream hears a median 4 ships in the box per frame and 0.2 positions a minute within 3 km of a cable (40 frames, 17 Oct 2026).",
};
