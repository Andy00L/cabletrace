import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// The Perth Protection Zone off City Beach, out to 2,000 m of water. OpenStreetMap maps no submarine cable here
// (Overpass, 17 Oct 2026: none in 113.3-116.2 E, 33.0-30.6 S), so the routes are ACMA's own cable locations.
export const PERTH: Region = {
  id: "perth",
  name: "Perth",
  box: { west: 113.5, east: 116.0, south: -32.8, north: -31.0 },
  timeZone: "Australia/Perth",
  liveSources: ["aisstream"],
  lineSources: ["acma-cable-locations-2021"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: [],
  incidents: [{ name: "Indigo West and Indigo Central (police assessing)", year: 2026, caseSlug: null }],
  reason:
    "Ranked sixth (ambition-pass 6.4): a live police case on two cables of the protection zone (August 2026). aisstream hears a median 10 ships in the box per frame and 0.3 positions a minute within 3 km of a cable (40 frames, 17 Oct 2026).",
};
