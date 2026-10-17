// Cross-source check (ambition-pass 4.1, the live layer's outside judge): where two independent feeds cover the same
// water, they must agree on which ships are there and where. The frame collector compares, on every run, the
// aisstream reports it heard with the Digitraffic snapshot it fetched for the same frame, inside each region recorded
// from Digitraffic (the Gulf of Finland), and stores one sample per region (public.cross_source_samples).
// scripts/regions/cross-source.ts judges the stored samples against the tolerances below.
//
// Import rule exception (see snapshot-codec.ts): the geodesy helpers come through the "@/" alias, which the
// collector's deno.json maps to the file, so this module stays the only copy of the distance maths.
import type { Result } from "../result.ts";
import type { ShipRecord } from "./snapshot-codec.ts";
import { createLocalFrame, distanceMetres } from "@/lib/detection/geodesy";

// A report pair counts as matched when both feeds stamped the ship within 2 minutes of each other; class A ships under
// way report every 2 to 10 s (ITU-R M.1371-5, Table 1), so both feeds normally hold a report from the same minute.
export const MATCH_WINDOW_MS = 2 * 60_000;
// Agreement on a position: within 250 m after moving the aisstream report to the Digitraffic report's time along its
// own course and speed. Both feeds relay the same transponder, so a shared message lands on the same spot; dead
// reckoning across up to 2 minutes at 20 knots with a 5 degree course error drifts about 110 m.
export const POSITION_TOLERANCE_METRES = 250;
// Verdict thresholds over a span of samples.
export const POSITION_AGREEMENT_MIN_SHARE = 0.95;
// Digitraffic's receivers cover the Gulf about 7 times more densely than aisstream's (DIGITRAFFIC_BOX in
// ship-merge.ts), so nearly every ship aisstream hears there must also be in Digitraffic's 30-minute snapshot.
export const SHIP_AGREEMENT_MIN_SHARE = 0.9;
// Fewer matched pairs than this over the judged span is too little to judge: the verdict is "no-data".
export const MIN_MATCHED_PAIRS = 20;
// Ships under this speed are compared where they are, without dead reckoning (their course is noise).
const DEAD_RECKONING_MIN_KNOTS = 0.5;
const METRES_PER_SECOND_PER_KNOT = 1852 / 3600;

export type Box = { west: number; east: number; south: number; north: number };

export type CrossSourceSample = {
  regionId: string;
  sampledAtMs: number;
  windowSeconds: number;
  /** Ships aisstream reported inside the box during the listening window. */
  aisstreamShips: number;
  /** Ships Digitraffic reported inside the box during the same window. */
  digitrafficShips: number;
  /** aisstream's ships that Digitraffic's snapshot (its last 30 minutes) also holds. */
  sharedShips: number;
  /** aisstream's ships missing from Digitraffic's snapshot: Digitraffic blind spots, outages or identity mismatches. */
  aisstreamOnlyShips: number;
  /** Shared ships whose two reports are at most MATCH_WINDOW_MS apart. */
  matchedPairs: number;
  medianOffsetMetres: number | null;
  p95OffsetMetres: number | null;
  /** Share of matched pairs within POSITION_TOLERANCE_METRES; null without pairs. */
  withinToleranceShare: number | null;
};

function isInside(box: Box, ship: ShipRecord): boolean {
  return ship.longitude >= box.west && ship.longitude <= box.east && ship.latitude >= box.south && ship.latitude <= box.north;
}

function quantile(sortedValues: readonly number[], fraction: number): number | null {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length))] ?? null;
}

/** Where `report` would be at `atMs` if it kept its course and speed. */
export function deadReckon(report: ShipRecord, atMs: number): { longitude: number; latitude: number } {
  const elapsedSeconds = (atMs - report.reportedAtMs) / 1000;
  if (report.speedKnots === null || report.courseDegrees === null || report.speedKnots < DEAD_RECKONING_MIN_KNOTS || elapsedSeconds === 0) {
    return { longitude: report.longitude, latitude: report.latitude };
  }
  const travelledMetres = report.speedKnots * METRES_PER_SECOND_PER_KNOT * elapsedSeconds;
  const courseRadians = (report.courseDegrees * Math.PI) / 180;
  const frame = createLocalFrame(report);
  return frame.toLonLat({ x: travelledMetres * Math.sin(courseRadians), y: travelledMetres * Math.cos(courseRadians) });
}

type CompareInput = {
  regionId: string;
  box: Box;
  /** The latest aisstream report per ship heard during the window. */
  aisstream: readonly ShipRecord[];
  /** Digitraffic's latest report per ship over its snapshot (the collector asks for the last 30 minutes). */
  digitraffic: readonly ShipRecord[];
  windowStartMs: number;
  sampledAtMs: number;
};

/** One sample: ship counts and position offsets of the two feeds inside one box. */
export function compareFeeds({ regionId, box, aisstream, digitraffic, windowStartMs, sampledAtMs }: CompareInput): CrossSourceSample {
  const aisstreamInBox = aisstream.filter((ship) => ship.source === "aisstream" && isInside(box, ship) && ship.reportedAtMs >= windowStartMs);
  const digitrafficByMmsi = new Map(digitraffic.filter((ship) => ship.source === "digitraffic").map((ship) => [ship.mmsi, ship]));
  const digitrafficInWindow = [...digitrafficByMmsi.values()].filter((ship) => isInside(box, ship) && ship.reportedAtMs >= windowStartMs);
  const offsets: number[] = [];
  let sharedShips = 0;
  for (const aisstreamReport of aisstreamInBox) {
    const digitrafficReport = digitrafficByMmsi.get(aisstreamReport.mmsi);
    if (digitrafficReport === undefined) continue;
    sharedShips += 1;
    if (Math.abs(digitrafficReport.reportedAtMs - aisstreamReport.reportedAtMs) > MATCH_WINDOW_MS) continue;
    offsets.push(distanceMetres(deadReckon(aisstreamReport, digitrafficReport.reportedAtMs), digitrafficReport));
  }
  offsets.sort((first, second) => first - second);
  const withinCount = offsets.filter((offset) => offset <= POSITION_TOLERANCE_METRES).length;
  return {
    regionId,
    sampledAtMs,
    windowSeconds: Math.round((sampledAtMs - windowStartMs) / 1000),
    aisstreamShips: aisstreamInBox.length,
    digitrafficShips: digitrafficInWindow.length,
    sharedShips,
    aisstreamOnlyShips: aisstreamInBox.length - sharedShips,
    matchedPairs: offsets.length,
    medianOffsetMetres: quantile(offsets, 0.5),
    p95OffsetMetres: quantile(offsets, 0.95),
    withinToleranceShare: offsets.length === 0 ? null : withinCount / offsets.length,
  };
}

function readCount(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readOptionalNumber(row: Record<string, unknown>, key: string): { isValid: boolean; value: number | null } {
  const value = row[key];
  if (value === null) return { isValid: true, value: null };
  return typeof value === "number" && Number.isFinite(value) ? { isValid: true, value } : { isValid: false, value: null };
}

/** Parses rows of public.cross_source_samples as the Data API returns them; one malformed row fails the whole read. */
export function parseCrossSourceRows(payload: unknown): Result<CrossSourceSample[]> {
  if (!Array.isArray(payload)) return { ok: false, reason: "cross-source samples are not an array" };
  const samples: CrossSourceSample[] = [];
  for (const row of payload) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return { ok: false, reason: "cross-source sample is not an object" };
    const record: Record<string, unknown> = { ...row };
    const sampledAtMs = typeof record.sampled_at === "string" ? Date.parse(record.sampled_at) : Number.NaN;
    const windowSeconds = readCount(record, "window_seconds");
    const aisstreamShips = readCount(record, "aisstream_ships");
    const digitrafficShips = readCount(record, "digitraffic_ships");
    const sharedShips = readCount(record, "shared_ships");
    const aisstreamOnlyShips = readCount(record, "aisstream_only_ships");
    const matchedPairs = readCount(record, "matched_pairs");
    const median = readOptionalNumber(record, "median_offset_metres");
    const p95 = readOptionalNumber(record, "p95_offset_metres");
    const share = readOptionalNumber(record, "within_tolerance_share");
    if (
      typeof record.region_id !== "string" ||
      Number.isNaN(sampledAtMs) ||
      windowSeconds === null ||
      aisstreamShips === null ||
      digitrafficShips === null ||
      sharedShips === null ||
      aisstreamOnlyShips === null ||
      matchedPairs === null ||
      !median.isValid ||
      !p95.isValid ||
      !share.isValid
    ) {
      return { ok: false, reason: "cross-source sample has a missing or malformed field" };
    }
    samples.push({
      regionId: record.region_id,
      sampledAtMs,
      windowSeconds,
      aisstreamShips,
      digitrafficShips,
      sharedShips,
      aisstreamOnlyShips,
      matchedPairs,
      medianOffsetMetres: median.value,
      p95OffsetMetres: p95.value,
      withinToleranceShare: share.value,
    });
  }
  return { ok: true, value: samples };
}

export type CrossSourceVerdict = {
  verdict: "agree" | "disagree" | "no-data";
  sampleCount: number;
  aisstreamShips: number;
  sharedShips: number;
  shipAgreementShare: number | null;
  matchedPairs: number;
  positionAgreementShare: number | null;
  reasons: string[];
};

/**
 * Judges a span of samples: the feeds agree when at least SHIP_AGREEMENT_MIN_SHARE of aisstream's ships are in
 * Digitraffic too and at least POSITION_AGREEMENT_MIN_SHARE of matched pairs sit within POSITION_TOLERANCE_METRES.
 * Shares are pooled over all samples (a sample with more ships weighs more), so a quiet hour does not swing the verdict.
 */
export function judgeSamples(samples: readonly CrossSourceSample[]): CrossSourceVerdict {
  const aisstreamShips = samples.reduce((total, sample) => total + sample.aisstreamShips, 0);
  const sharedShips = samples.reduce((total, sample) => total + sample.sharedShips, 0);
  const matchedPairs = samples.reduce((total, sample) => total + sample.matchedPairs, 0);
  const withinPairs = samples.reduce((total, sample) => total + (sample.withinToleranceShare ?? 0) * sample.matchedPairs, 0);
  const shipAgreementShare = aisstreamShips === 0 ? null : sharedShips / aisstreamShips;
  const positionAgreementShare = matchedPairs === 0 ? null : withinPairs / matchedPairs;
  const summary = { sampleCount: samples.length, aisstreamShips, sharedShips, shipAgreementShare, matchedPairs, positionAgreementShare };
  if (matchedPairs < MIN_MATCHED_PAIRS || shipAgreementShare === null || positionAgreementShare === null) {
    return { verdict: "no-data", ...summary, reasons: [`${matchedPairs} matched pairs in ${samples.length} samples, fewer than ${MIN_MATCHED_PAIRS}`] };
  }
  const reasons: string[] = [];
  if (shipAgreementShare < SHIP_AGREEMENT_MIN_SHARE) {
    reasons.push(`Digitraffic holds ${Math.round(shipAgreementShare * 100)}% of the ships aisstream hears, under ${SHIP_AGREEMENT_MIN_SHARE * 100}%`);
  }
  if (positionAgreementShare < POSITION_AGREEMENT_MIN_SHARE) {
    reasons.push(`${Math.round(positionAgreementShare * 100)}% of matched positions within ${POSITION_TOLERANCE_METRES} m, under ${POSITION_AGREEMENT_MIN_SHARE * 100}%`);
  }
  return { verdict: reasons.length === 0 ? "agree" : "disagree", ...summary, reasons };
}
