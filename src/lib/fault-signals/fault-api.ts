import type { Result } from "@/lib/result";
import type { MatchBasis } from "@/lib/fault-signals/cable-matcher";
import type { RankBasis, RankedShip } from "@/lib/fault-signals/draft-case";
import type { SignalKind, SignalSource } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readFiniteNumber, readIsoTime, readText } from "@/lib/fault-signals/read-json";

// The three public lookups of fault signals and draft cases, made with the publishable key (the same call as
// src/lib/globe/live-api.ts): public.recent_draft_cases, public.draft_case_detail and public.recent_fault_signals
// (supabase/migrations/20261019300000_fault_signals.sql). Every answer is validated here. A draft case is a list of
// ships to look at first and is shown as a draft everywhere, never as a finding.

export type DraftShipSummary = Pick<RankedShip, "rank" | "mmsi" | "name" | "basis" | "level" | "score" | "closestApproachMetres">;

export type DraftSignal = {
  id: number;
  source: SignalSource;
  kind: SignalKind;
  title: string;
  faultNotBeforeMs: number;
  faultNotAfterMs: number;
  publishedAtMs: number;
  sourceUrl: string;
  cableShip: string | null;
};

type DraftCaseFields = {
  id: number;
  status: "draft";
  cableName: string;
  cableKind: string;
  faultNotBeforeMs: number;
  faultNotAfterMs: number;
  windowStartMs: number;
  windowEndMs: number;
  nearMetres: number;
  shipCount: number;
  openedAtMs: number;
  updatedAtMs: number;
};

export type DraftCaseSummary = DraftCaseFields & { topShips: DraftShipSummary[]; signals: DraftSignal[] };
export type DraftCaseDetail = DraftCaseFields & { rankingSignalId: number | null; ships: RankedShip[]; signals: (DraftSignal & { excerpt: string })[] };

export type FaultSignalSummary = {
  id: number;
  source: SignalSource;
  kind: SignalKind;
  title: string;
  faultNotBeforeMs: number;
  faultNotAfterMs: number;
  publishedAtMs: number;
  endsAtMs: number | null;
  sourceUrl: string;
  cableShip: string | null;
  cables: { name: string; basis: MatchBasis; distanceMetres: number | null }[];
  draftCaseIds: number[];
};

const REQUEST_TIMEOUT_MS = 15_000;
const SOURCES: readonly SignalSource[] = ["nga-warning", "ioda-alert", "entsoe-unavailability", "nordpool-umm", "operator-notice"];
const KINDS: readonly SignalKind[] = ["cable-damage", "cable-repair", "cable-operations", "power-link-failure", "internet-outage"];
const RANK_BASES: readonly RankBasis[] = ["drag-at-fault", "unjudged-at-fault", "drag-elsewhere", "unjudged", "no-fit", "outside-drag-band", "not-eligible"];
const MATCH_BASES: readonly MatchBasis[] = ["geometry", "asset-name", "border", "country"];

function isOneOf<Value extends string>(options: readonly Value[], value: unknown): value is Value {
  return options.some((option) => option === value);
}

function readLevel(value: unknown): "alert" | "watch" | null | undefined {
  if (value === null || value === undefined) return null;
  return value === "alert" || value === "watch" ? value : undefined;
}

type ApiConfig = { projectUrl: string; publishableKey: string };

function readApiConfig(): Result<ApiConfig> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "the Supabase address or publishable key is not configured" };
  return { ok: true, value: { projectUrl: projectUrl.replace(/\/+$/u, ""), publishableKey } };
}

// The same request as callFunction in src/lib/globe/live-api.ts; both belong in one shared module.
async function callFunction(functionName: string, body: Record<string, unknown>): Promise<Result<unknown>> {
  const config = readApiConfig();
  if (!config.ok) return config;
  try {
    const response = await fetch(`${config.value.projectUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: { apikey: config.value.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `${functionName} answered ${response.status}` };
    const payload: unknown = await response.json();
    return { ok: true, value: payload };
  } catch (error) {
    return { ok: false, reason: `${functionName} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parseDraftShipSummary(value: unknown): DraftShipSummary | null {
  if (!isRecord(value)) return null;
  const rank = readFiniteNumber(value.rank);
  const mmsi = readFiniteNumber(value.mmsi);
  const closestApproachMetres = readFiniteNumber(value.closestApproachMetres);
  const level = readLevel(value.level);
  if (rank === null || mmsi === null || closestApproachMetres === null || level === undefined || !isOneOf(RANK_BASES, value.basis)) return null;
  return { rank, mmsi, name: readText(value.name), basis: value.basis, level, score: readFiniteNumber(value.score), closestApproachMetres };
}

/** One ranked ship of a draft case in full; null when malformed. */
export function parseRankedShip(value: unknown): RankedShip | null {
  const summary = parseDraftShipSummary(value);
  if (summary === null || !isRecord(value) || !Array.isArray(value.sentences)) return null;
  const closestApproachAtMs = readFiniteNumber(value.closestApproachAtMs);
  const reportCount = readFiniteNumber(value.reportCount);
  if (closestApproachAtMs === null || reportCount === null) return null;
  return {
    ...summary,
    crossingAtMs: readFiniteNumber(value.crossingAtMs),
    closestApproachAtMs,
    reportCount,
    sentences: value.sentences.flatMap((sentence) => (typeof sentence === "string" ? [sentence] : [])),
  };
}

function parseDraftSignal(value: unknown): DraftSignal | null {
  if (!isRecord(value)) return null;
  const id = readFiniteNumber(value.id);
  const title = readText(value.title);
  const sourceUrl = readText(value.sourceUrl);
  const faultNotBeforeMs = readIsoTime(value.faultNotBefore);
  const faultNotAfterMs = readIsoTime(value.faultNotAfter);
  const publishedAtMs = readIsoTime(value.publishedAt);
  if (id === null || title === null || sourceUrl === null || faultNotBeforeMs === null || faultNotAfterMs === null || publishedAtMs === null) return null;
  if (!isOneOf(SOURCES, value.source) || !isOneOf(KINDS, value.kind)) return null;
  return { id, source: value.source, kind: value.kind, title, faultNotBeforeMs, faultNotAfterMs, publishedAtMs, sourceUrl, cableShip: readText(value.cableShip) };
}

function parseDraftCaseFields(value: unknown): DraftCaseFields | null {
  if (!isRecord(value) || value.status !== "draft") return null;
  const fields = {
    id: readFiniteNumber(value.id),
    cableName: readText(value.cableName),
    cableKind: readText(value.cableKind),
    faultNotBeforeMs: readIsoTime(value.faultNotBefore),
    faultNotAfterMs: readIsoTime(value.faultNotAfter),
    windowStartMs: readIsoTime(value.windowStart),
    windowEndMs: readIsoTime(value.windowEnd),
    nearMetres: readFiniteNumber(value.nearMetres),
    shipCount: readFiniteNumber(value.shipCount),
    openedAtMs: readIsoTime(value.openedAt),
    updatedAtMs: readIsoTime(value.updatedAt),
  };
  const { id, cableName, cableKind, faultNotBeforeMs, faultNotAfterMs, windowStartMs, windowEndMs, nearMetres, shipCount, openedAtMs, updatedAtMs } = fields;
  if (id === null || cableName === null || cableKind === null || faultNotBeforeMs === null || faultNotAfterMs === null || windowStartMs === null || windowEndMs === null) return null;
  if (nearMetres === null || shipCount === null || openedAtMs === null || updatedAtMs === null) return null;
  return { id, status: "draft", cableName, cableKind, faultNotBeforeMs, faultNotAfterMs, windowStartMs, windowEndMs, nearMetres, shipCount, openedAtMs, updatedAtMs };
}

/** Parses every item with `parse`; null when the value is not a list or any item is malformed. */
function parseAll<Item>(value: unknown, parse: (item: unknown) => Item | null): Item[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  const valid = parsed.filter((item): item is Item => item !== null);
  return valid.length === parsed.length ? valid : null;
}

export function parseDraftCaseSummary(value: unknown): DraftCaseSummary | null {
  const fields = parseDraftCaseFields(value);
  if (fields === null || !isRecord(value)) return null;
  const topShips = parseAll(value.topShips, parseDraftShipSummary);
  const signals = parseAll(value.signals, parseDraftSignal);
  return topShips && signals ? { ...fields, topShips, signals } : null;
}

export function parseDraftCaseDetail(value: unknown): DraftCaseDetail | null {
  const fields = parseDraftCaseFields(value);
  if (fields === null || !isRecord(value)) return null;
  const ships = parseAll(value.ships, parseRankedShip);
  const signals = parseAll(value.signals, (item) => {
    const signal = parseDraftSignal(item);
    return signal && isRecord(item) && typeof item.excerpt === "string" ? { ...signal, excerpt: item.excerpt } : null;
  });
  return ships && signals ? { ...fields, rankingSignalId: readFiniteNumber(value.rankingSignalId), ships, signals } : null;
}

export function parseFaultSignalSummary(value: unknown): FaultSignalSummary | null {
  const signal = parseDraftSignal(value);
  if (signal === null || !isRecord(value)) return null;
  const cables = parseAll(value.cables, (item) => {
    if (!isRecord(item) || !isOneOf(MATCH_BASES, item.basis)) return null;
    const name = readText(item.name);
    return name === null ? null : { name, basis: item.basis, distanceMetres: readFiniteNumber(item.distanceMetres) };
  });
  const draftCaseIds = parseAll(value.draftCaseIds, readFiniteNumber);
  if (cables === null || draftCaseIds === null) return null;
  return { ...signal, endsAtMs: readIsoTime(value.endsAt), cables, draftCaseIds };
}

/** Draft cases updated in the last `sinceDays` days (1 to 365), newest fault first, at most 20. */
export async function fetchRecentDraftCases(sinceDays = 30): Promise<Result<DraftCaseSummary[]>> {
  const answer = await callFunction("recent_draft_cases", { since_days: sinceDays });
  if (!answer.ok) return answer;
  const drafts = parseAll(answer.value, parseDraftCaseSummary);
  return drafts ? { ok: true, value: drafts } : { ok: false, reason: "recent_draft_cases returned a malformed draft" };
}

/** One draft case with every ranked ship and its signals, or null when no draft has that id. */
export async function fetchDraftCaseDetail(draftCaseId: number): Promise<Result<DraftCaseDetail | null>> {
  const answer = await callFunction("draft_case_detail", { draft_case_id: draftCaseId });
  if (!answer.ok) return answer;
  if (answer.value === null) return { ok: true, value: null };
  const detail = parseDraftCaseDetail(answer.value);
  return detail ? { ok: true, value: detail } : { ok: false, reason: "draft_case_detail returned a malformed draft" };
}

/** Signals published in the last `sinceDays` days (1 to 90) that concern a registry cable, newest first, at most 50. */
export async function fetchRecentFaultSignals(sinceDays = 7): Promise<Result<FaultSignalSummary[]>> {
  const answer = await callFunction("recent_fault_signals", { since_days: sinceDays });
  if (!answer.ok) return answer;
  const signals = parseAll(answer.value, parseFaultSignalSummary);
  return signals ? { ok: true, value: signals } : { ok: false, reason: "recent_fault_signals returned a malformed signal" };
}
