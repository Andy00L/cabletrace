import type { SeedOptions } from "@/lib/regions/line-network";

// How every region's cable and pipeline seed is cut from its source (scripts/regions/build-cable-seed.ts), and the same
// lines the coverage measurement uses (scripts/regions/measure-coverage.ts).
// - margin 0.1 degrees (5.6 to 11 km): more than the 3 km near-cable distance, so a position at the box edge still
//   finds the cable outside it;
// - simplified to 100 m: a position 3 km away is judged within 100 m of the true distance, and the detector's anchor
//   path, uncertain by hundreds of metres (src/lib/detection/anchor-path.ts), crosses the same cables;
// - lines shorter than 5 km inside the box left out: harbour and island crossings, whose ferries and pleasure craft
//   would fill the table with positions no anchor drag explains.
export const SEED_OPTIONS: Omit<SeedOptions, "box"> = {
  marginDegrees: 0.1,
  simplifyMetres: 100,
  minimumLengthMetres: 5000,
};
