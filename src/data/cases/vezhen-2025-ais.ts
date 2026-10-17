import type { AisFix } from "@/lib/cases/case-file";

// Generated, do not edit by hand. Vezhen (MMSI 229659000) in the Danish Maritime Authority archive file
// aisdk-2025-01-26.zip, 00:30 to 20:00 UTC, the first row of every 2 minutes and the last row of the span:
//   bun scripts/cases/extract-ais-fixes.ts aisdk-2025-01-26.csv 229659000 2025-01-26T00:30:00Z 2025-01-26T20:00:00Z 120
// The archive holds no Vezhen rows on 25 January and none on 26 January before 17:05:43. Gaps over 5 minutes:
// 17:07:03 to 17:17:46 and 18:23:22 to 18:39:12.
export const VEZHEN_AIS_FIXES: AisFix[] = [
  { atUtc: "2025-01-26T17:05:43Z", longitude: 15.83719, latitude: 55.86618, speedKnots: 6 },
  { atUtc: "2025-01-26T17:06:53Z", longitude: 15.83377, latitude: 55.86652, speedKnots: 6 },
  { atUtc: "2025-01-26T17:17:46Z", longitude: 15.80023, latitude: 55.86761, speedKnots: 6.9 },
  { atUtc: "2025-01-26T17:20:33Z", longitude: 15.79058, latitude: 55.86899, speedKnots: 7.6 },
  { atUtc: "2025-01-26T17:22:03Z", longitude: 15.78584, latitude: 55.87073, speedKnots: 7.7 },
  { atUtc: "2025-01-26T17:24:03Z", longitude: 15.77944, latitude: 55.87323, speedKnots: 8 },
  { atUtc: "2025-01-26T17:26:03Z", longitude: 15.77277, latitude: 55.87584, speedKnots: 8.5 },
  { atUtc: "2025-01-26T17:28:03Z", longitude: 15.76585, latitude: 55.87899, speedKnots: 9.2 },
  { atUtc: "2025-01-26T17:30:03Z", longitude: 15.75846, latitude: 55.88234, speedKnots: 9.8 },
  { atUtc: "2025-01-26T17:32:12Z", longitude: 15.75018, latitude: 55.88603, speedKnots: 10.1 },
  { atUtc: "2025-01-26T17:34:12Z", longitude: 15.74209, latitude: 55.88951, speedKnots: 10.4 },
  { atUtc: "2025-01-26T17:36:12Z", longitude: 15.73377, latitude: 55.89303, speedKnots: 10.6 },
  { atUtc: "2025-01-26T17:38:03Z", longitude: 15.72589, latitude: 55.89630, speedKnots: 10.7 },
  { atUtc: "2025-01-26T17:40:12Z", longitude: 15.71670, latitude: 55.90019, speedKnots: 10.8 },
  { atUtc: "2025-01-26T17:42:33Z", longitude: 15.70649, latitude: 55.90444, speedKnots: 10.8 },
  { atUtc: "2025-01-26T17:44:02Z", longitude: 15.70012, latitude: 55.90707, speedKnots: 10.9 },
  { atUtc: "2025-01-26T17:46:02Z", longitude: 15.69152, latitude: 55.91072, speedKnots: 10.9 },
  { atUtc: "2025-01-26T17:48:02Z", longitude: 15.68298, latitude: 55.91440, speedKnots: 10.8 },
  { atUtc: "2025-01-26T17:50:13Z", longitude: 15.67300, latitude: 55.91777, speedKnots: 10.7 },
  { atUtc: "2025-01-26T17:52:13Z", longitude: 15.66430, latitude: 55.92110, speedKnots: 10.7 },
  { atUtc: "2025-01-26T17:54:13Z", longitude: 15.65540, latitude: 55.92444, speedKnots: 10.8 },
  { atUtc: "2025-01-26T17:56:13Z", longitude: 15.64645, latitude: 55.92784, speedKnots: 10.9 },
  { atUtc: "2025-01-26T17:58:03Z", longitude: 15.63821, latitude: 55.93096, speedKnots: 10.9 },
  { atUtc: "2025-01-26T18:00:03Z", longitude: 15.62870, latitude: 55.93392, speedKnots: 11.1 },
  { atUtc: "2025-01-26T18:02:13Z", longitude: 15.61826, latitude: 55.93713, speedKnots: 11.1 },
  { atUtc: "2025-01-26T18:04:02Z", longitude: 15.60927, latitude: 55.93964, speedKnots: 11.1 },
  { atUtc: "2025-01-26T18:06:02Z", longitude: 15.59953, latitude: 55.94256, speedKnots: 11.1 },
  { atUtc: "2025-01-26T18:08:02Z", longitude: 15.58978, latitude: 55.94544, speedKnots: 11.2 },
  { atUtc: "2025-01-26T18:10:21Z", longitude: 15.57842, latitude: 55.94891, speedKnots: 11.2 },
  { atUtc: "2025-01-26T18:12:02Z", longitude: 15.57030, latitude: 55.95139, speedKnots: 11.2 },
  { atUtc: "2025-01-26T18:14:02Z", longitude: 15.56047, latitude: 55.95426, speedKnots: 11.2 },
  { atUtc: "2025-01-26T18:16:02Z", longitude: 15.55070, latitude: 55.95719, speedKnots: 11.2 },
  { atUtc: "2025-01-26T18:18:02Z", longitude: 15.54183, latitude: 55.96073, speedKnots: 10.6 },
  { atUtc: "2025-01-26T18:22:13Z", longitude: 15.53370, latitude: 55.97101, speedKnots: 9.2 },
  { atUtc: "2025-01-26T18:39:12Z", longitude: 15.51512, latitude: 56.00044, speedKnots: 5.3 },
];
