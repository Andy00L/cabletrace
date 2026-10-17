import type { CrossSourceVerdict } from "@/lib/live/cross-source";
import type { Result } from "@/lib/result";

// The feed check as /api/health reports it (`crossSource`), and the browser's read of it for the /live moment card.
// The samples behind it are server-only (supabase/migrations/20261019600200_cross_source_server_only.sql), so the
// browser reads the CDN-cached health answer instead of Supabase. No environment variables here: the browser imports
// this file.

/** One region's verdict, shares rounded to 3 decimals. */
export type FeedCheckRegion = {
  regionId: string;
  verdict: CrossSourceVerdict["verdict"];
  hours: number;
  samples: number;
  shipAgreementShare: number | null;
  matchedPairs: number;
  positionAgreementShare: number | null;
  reasons: string[];
};

const VERDICTS: readonly CrossSourceVerdict["verdict"][] = ["agree", "disagree", "no-data"];
const HEALTH_URL = "/api/health";
const FETCH_TIMEOUT_MS = 10_000;

function roundShare(share: number | null): number | null {
  return share === null ? null : Math.round(share * 1000) / 1000;
}

/** The report of one region's verdict over `hours`. */
export function toFeedCheckRegion(regionId: string, verdict: CrossSourceVerdict, hours: number): FeedCheckRegion {
  return {
    regionId,
    verdict: verdict.verdict,
    hours,
    samples: verdict.sampleCount,
    shipAgreementShare: roundShare(verdict.shipAgreementShare),
    matchedPairs: verdict.matchedPairs,
    positionAgreementShare: roundShare(verdict.positionAgreementShare),
    reasons: verdict.reasons,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVerdict(value: unknown): value is CrossSourceVerdict["verdict"] {
  return VERDICTS.some((verdict) => verdict === value);
}

function readShare(value: unknown): { isValid: boolean; share: number | null } {
  if (value === null) return { isValid: true, share: null };
  return typeof value === "number" && value >= 0 && value <= 1 ? { isValid: true, share: value } : { isValid: false, share: null };
}

function parseFeedCheckRegion(value: unknown): FeedCheckRegion | null {
  if (!isRecord(value) || typeof value.regionId !== "string" || !isVerdict(value.verdict)) return null;
  const { hours, samples, matchedPairs, reasons } = value;
  const shipShare = readShare(value.shipAgreementShare);
  const positionShare = readShare(value.positionAgreementShare);
  if (typeof hours !== "number" || typeof samples !== "number" || typeof matchedPairs !== "number" || !shipShare.isValid || !positionShare.isValid) return null;
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === "string")) return null;
  return { regionId: value.regionId, verdict: value.verdict, hours, samples, shipAgreementShare: shipShare.share, matchedPairs, positionAgreementShare: positionShare.share, reasons };
}

/** Reads `crossSource` from a health answer; a feed check the server could not read is a failure. */
export function parseFeedCheck(payload: unknown): Result<FeedCheckRegion[]> {
  if (!isRecord(payload) || !Array.isArray(payload.crossSource)) return { ok: false, reason: "the health answer has no feed check" };
  const regions = payload.crossSource.map(parseFeedCheckRegion);
  const validRegions = regions.filter((region): region is FeedCheckRegion => region !== null);
  if (validRegions.length !== regions.length) return { ok: false, reason: "the health answer has a malformed feed check" };
  return { ok: true, value: validRegions };
}

/** The browser's read of the feed check, from the CDN-cached health answer. */
export async function fetchFeedCheck(): Promise<Result<FeedCheckRegion[]>> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: `${HEALTH_URL} answered ${response.status}` };
    return parseFeedCheck(await response.json());
  } catch (error) {
    return { ok: false, reason: `${HEALTH_URL} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
