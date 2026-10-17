import type { Region } from "@/lib/regions/region";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";

// The region CableTrace has recorded since 2026-10-17 02:22 UTC (supabase/functions/record-vessel-positions). Box as
// in that function's first version; Digitraffic sees about 7 times more ships here than aisstream (DIGITRAFFIC_BOX in
// src/lib/live/ship-merge.ts), so it stays the recording source and aisstream serves the cross-source check.
export const GULF_OF_FINLAND: Region = {
  id: "gulf-of-finland",
  name: "Gulf of Finland",
  box: { west: 22.0, east: 30.5, south: 59.0, north: 60.8 },
  timeZone: "Europe/Helsinki",
  liveSources: ["digitraffic"],
  // Cables from OpenStreetMap, pipelines from EMODnet (supabase/migrations/20261017020100_seed_gulf_cables.sql).
  lineSources: ["openstreetmap", "emodnet-human-activities"],
  recording: DEFAULT_RECORDING,
  seabedAreaIds: ["gulf-of-finland", "gulf-of-finland-and-hiiumaa"],
  incidents: [
    { name: "Balticconnector and EE-S1 (Newnew Polar Bear)", year: 2023, caseSlug: "newnew-polar-bear-2023" },
    { name: "Estlink 2 and four telecom cables (Eagle S)", year: 2024, caseSlug: "eagle-s-2024" },
    { name: "Helsinki to Tallinn cables (Fitburg)", year: 2025, caseSlug: "fitburg-2025" },
  ],
  reason:
    "Three anchor drags since 2023 and the only free, licensed per-minute feed (Digitraffic, CC BY 4.0). Measured 2026-10-17: 46 stored positions a minute after thinning (2,771 in the hour to 15:52 UTC).",
};
