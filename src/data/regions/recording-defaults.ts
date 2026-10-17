import type { RecordingThresholds } from "@/lib/regions/region";

// The recorder's thresholds as set for the Gulf of Finland (supabase/migrations/20261017040000_thin_stationary_positions.sql):
// 3 km from a cable; a report under 0.5 knots, or without speed, is skipped when the ship has a stored position less
// than 10 minutes older and 50 m away. A region changes one only with a measured reason.
//
// Measured on 2026-10-17 (docs/REGIONS.md): Yi Peng 3's real AIS drag (DMA archive, 281 rows) still alerts at score 0.7
// when only rows within 10 km of a Central Baltic cable are kept, and not at all within 3 or 5 km (107 and 222 rows):
// the speed-deficit rule needs the hour of normal sailing before the run, away from the cables. Widening to 10 km
// multiplies stored rows by 1.7 to 2.6 per region and the detector's reads with them, which the free plan's 5 GB of
// egress carries only with the detector every 60 minutes instead of 30. Until that decision, 3 km stays.
//
// Hot retention drops from 14 days to 72 hours: older days of sources without a retention cap move to compressed daily
// files in Storage (supabase/functions/record-vessel-positions/archive.ts). The detector reads 6 hours; 72 leave three
// days to replay or re-run it.
export const DEFAULT_RECORDING: RecordingThresholds = {
  nearCableMetres: 3000,
  candidateCableMetres: 3000,
  stationaryKnots: 0.5,
  stationaryRepeatMinutes: 10,
  stationaryRepeatMetres: 50,
  hotRetentionHours: 72,
};
