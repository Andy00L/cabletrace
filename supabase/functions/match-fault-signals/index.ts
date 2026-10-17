// Fault-signal matcher: pg_cron (supabase/migrations/20261019300100_fault_signals_schedule.sql) calls it with the
// source to poll, {"sources": ["nga"]}, ["ioda"] or ["entsoe"]. It reads the source, keeps the signals no call has
// processed, matches them to the registry cables, opens a draft case for each signal that names a cable (the ships
// recorded near it before the fault, ranked by the anchor-drag detector), and stores the whole call in one transaction
// (public.store_fault_run). Parsing, matching and ranking are the shared code of src/lib/fault-signals, reached through
// this folder's deno.json import map. Drafts are never findings: the database refuses any status but 'draft'.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "@/lib/result";
import type { DepthLookup } from "@/lib/detection/detection-types";
import { zoneOfCountry } from "@/lib/fault-signals/bidding-zones";
import { matchSignalToCables, type CableMatch } from "@/lib/fault-signals/cable-matcher";
import { DRAFT_NEAR_CABLE_METRES, buildDraftCase, draftWindowFor, type DraftCase } from "@/lib/fault-signals/draft-case";
import { buildEntsoeOutageUrl, parseEntsoeOutages } from "@/lib/fault-signals/entsoe-unavailability";
import { parseFaultCaseInputs, parseMatchInputs } from "@/lib/fault-signals/fault-inputs";
import type { FaultSignal, RegistryCable, SignalSource } from "@/lib/fault-signals/fault-signal-types";
import { buildIodaAlertsUrl, parseIodaAlerts } from "@/lib/fault-signals/ioda-alerts";
import { NGA_ACTIVE_WARNINGS_URL, parseNgaWarnings } from "@/lib/fault-signals/nga-warnings";
import { toSeabedData } from "@/lib/seabed/seabed-data";
import { createElevationSampler, createProjection } from "@/lib/seabed/terrain";

type PolledSource = "nga" | "ioda" | "entsoe";

const SIGNAL_SOURCES: Readonly<Record<PolledSource, SignalSource>> = { nga: "nga-warning", ioda: "ioda-alert", entsoe: "entsoe-unavailability" };
// IODA is called every 15 minutes; reading the last 30 catches alerts IODA writes a few minutes late.
const IODA_LOOKBACK_MS = 30 * 60 * 1000;
// ENTSO-E is called hourly; outages published or updated in the last 2 hours, for the same reason.
const ENTSOE_UPDATE_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
// Sent to every source so its operators can see who calls.
const USER_AGENT = "CableTrace fault-signal matcher (https://cabletrace.vercel.app)";
// The depth grid of the recorder's region, as in supabase/functions/detect-anchor-drag/index.ts.
const DEFAULT_SEABED_BASE_URL = "https://cabletrace.vercel.app/seabed";
const SEABED_AREA = "gulf-of-finland";

type DraftRow = DraftCase & { externalId: string; cableId: number; faultNotBeforeMs: number; faultNotAfterMs: number; windowFromMs: number; windowToMs: number };
type MatchRow = CableMatch & { externalId: string };
type SourceOutcome = { source: PolledSource; skipped: string | null; fetched: number; fresh: number; matched: number; drafts: number; stored: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same as supabase/functions/detect-anchor-drag/index.ts; all three functions' copies belong in supabase/functions/_shared.
function isSameSecret(received: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

// Same as supabase/functions/detect-anchor-drag/index.ts (see isSameSecret).
function createDatabaseClient(): Result<SupabaseClient> {
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!projectUrl || !secretKeys) return { ok: false, reason: "SUPABASE_URL or SUPABASE_SECRET_KEYS missing" };
  let parsedKeys: unknown;
  try {
    parsedKeys = JSON.parse(secretKeys);
  } catch {
    return { ok: false, reason: "SUPABASE_SECRET_KEYS is not JSON" };
  }
  const secretKey = isRecord(parsedKeys) ? parsedKeys.default : undefined;
  if (typeof secretKey !== "string") return { ok: false, reason: "SUPABASE_SECRET_KEYS has no default key" };
  return { ok: true, value: createClient(projectUrl, secretKey, { auth: { persistSession: false } }) };
}

// Kept for the life of the worker: the grid does not change between calls.
let cachedDepthLookup: DepthLookup | null = null;

/** Same as loadDepthLookup in supabase/functions/detect-anchor-drag/index.ts: null (unknown depth) when unreadable. */
async function loadDepthLookup(): Promise<DepthLookup | null> {
  if (cachedDepthLookup) return cachedDepthLookup;
  const baseUrl = Deno.env.get("SEABED_BASE_URL") ?? DEFAULT_SEABED_BASE_URL;
  try {
    const [featuresResponse, terrainResponse] = await Promise.all([
      fetch(`${baseUrl}/${SEABED_AREA}-seabed.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${baseUrl}/${SEABED_AREA}-terrain.bin`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);
    if (!featuresResponse.ok || !terrainResponse.ok) {
      console.error(`[loadDepthLookup] seabed files answered ${featuresResponse.status} and ${terrainResponse.status}`);
      return null;
    }
    const seabed = toSeabedData(await featuresResponse.json(), await terrainResponse.arrayBuffer());
    if (!seabed.ok) {
      console.error(`[loadDepthLookup] ${seabed.reason}`);
      return null;
    }
    const { region, grid } = seabed.value.features;
    const projection = createProjection(region);
    const sampleElevation = createElevationSampler(seabed.value.elevations, grid, projection);
    cachedDepthLookup = (longitude, latitude) => {
      if (longitude < region.west || longitude > region.east || latitude < region.south || latitude > region.north) return null;
      const scenePoint = projection.toScene(longitude, latitude);
      return sampleElevation(scenePoint.x, scenePoint.z);
    };
    return cachedDepthLookup;
  } catch (error) {
    console.error(`[loadDepthLookup] seabed files unreachable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// A network error's text can quote the URL it failed on, query string included (the ENTSO-E token travels there):
// every query string in it is cut before the text is logged or returned (security re-review, 17 Oct 2026).
function withoutQueryStrings(message: string): string {
  return message.replace(/\?[^\s)"'<>]*/gu, "?<query removed>");
}

/**
 * GETs a source; `label` names it in errors, because the URL may carry a token and is never logged. With
 * `keepErrorBody`, an error status still returns the body, for a source that explains refusals in it.
 */
async function fetchBytes(url: string, label: string, keepErrorBody = false): Promise<Result<Uint8Array>> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok && !keepErrorBody) return { ok: false, reason: `${label} answered ${response.status}` };
    return { ok: true, value: bytes };
  } catch (error) {
    return { ok: false, reason: `${label} unreachable: ${withoutQueryStrings(error instanceof Error ? error.message : String(error))}` };
  }
}

async function fetchJson(url: string, label: string): Promise<Result<unknown>> {
  const bytes = await fetchBytes(url, label);
  if (!bytes.ok) return bytes;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes.value));
    return { ok: true, value: payload };
  } catch {
    return { ok: false, reason: `${label} did not answer JSON` };
  }
}

async function readRegistry(database: SupabaseClient, includeRoutes: boolean): Promise<Result<RegistryCable[]>> {
  const { data, error } = await database.rpc("fault_match_inputs", { include_routes: includeRoutes });
  if (error) return { ok: false, reason: `fault_match_inputs failed: ${error.message}` };
  return parseMatchInputs(data);
}

/** The bidding-zone borders of the registry's power links, both directions, for the ENTSO-E query. */
function powerBorders(cables: readonly RegistryCable[]): { inDomain: string; outDomain: string }[] {
  const borders = new Map<string, { inDomain: string; outDomain: string }>();
  for (const cable of cables) {
    if (cable.kind !== "power" || cable.countries.length !== 2) continue;
    const [firstZone, secondZone] = cable.countries.map(zoneOfCountry);
    if (!firstZone || !secondZone) continue;
    borders.set(`${firstZone}>${secondZone}`, { inDomain: secondZone, outDomain: firstZone });
    borders.set(`${secondZone}>${firstZone}`, { inDomain: firstZone, outDomain: secondZone });
  }
  return [...borders.values()];
}

async function fetchEntsoeSignals(token: string, database: SupabaseClient): Promise<Result<FaultSignal[]>> {
  const registry = await readRegistry(database, false);
  if (!registry.ok) return registry;
  const nowMs = Date.now();
  const signals = new Map<string, FaultSignal>();
  for (const border of powerBorders(registry.value)) {
    // ENTSO-E answers a refused query with an XML acknowledgement and a 4xx status; its parser reads the reason.
    const answer = await fetchBytes(buildEntsoeOutageUrl({ token, ...border, updatedFromMs: nowMs - ENTSOE_UPDATE_LOOKBACK_MS, untilMs: nowMs }), "ENTSO-E", true);
    if (!answer.ok) return answer;
    const parsed = await parseEntsoeOutages(answer.value);
    if (!parsed.ok) return parsed;
    for (const signal of parsed.value.signals) signals.set(signal.externalId, signal);
  }
  return { ok: true, value: [...signals.values()] };
}

/** The source's current signals, or a reason to skip it this time. */
async function fetchSignals(source: PolledSource, database: SupabaseClient): Promise<Result<FaultSignal[]> | { skipped: string }> {
  switch (source) {
    case "nga": {
      const payload = await fetchJson(NGA_ACTIVE_WARNINGS_URL, "NGA");
      if (!payload.ok) return payload;
      const parsed = parseNgaWarnings(payload.value);
      return parsed.ok ? { ok: true, value: parsed.value.signals } : parsed;
    }
    case "ioda": {
      const nowMs = Date.now();
      const payload = await fetchJson(buildIodaAlertsUrl(nowMs - IODA_LOOKBACK_MS, nowMs), "IODA");
      return payload.ok ? parseIodaAlerts(payload.value) : payload;
    }
    case "entsoe": {
      const token = Deno.env.get("ENTSO_E_TOKEN");
      if (!token) return { skipped: "ENTSO_E_TOKEN is not set" };
      return fetchEntsoeSignals(token, database);
    }
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

async function buildDraft(database: SupabaseClient, signal: FaultSignal, match: CableMatch): Promise<Result<DraftRow>> {
  const window = draftWindowFor(signal);
  const { data, error } = await database.rpc("fault_case_inputs", {
    affected_cable_id: match.cableId,
    window_from: new Date(window.fromMs).toISOString(),
    window_until: new Date(window.toMs).toISOString(),
    near_metres: DRAFT_NEAR_CABLE_METRES,
  });
  if (error) return { ok: false, reason: `fault_case_inputs failed: ${error.message}` };
  const inputs = parseFaultCaseInputs(data);
  if (!inputs.ok) return inputs;
  if (inputs.value.cable.length === 0) return { ok: false, reason: `cable ${match.cableId} has no route` };
  const draft = buildDraftCase({
    signal,
    cableName: match.cableName,
    cable: inputs.value.cable,
    window,
    nearMetres: DRAFT_NEAR_CABLE_METRES,
    candidates: inputs.value.candidates,
    passers: inputs.value.passers,
    names: inputs.value.names,
    depthAt: await loadDepthLookup(),
  });
  return {
    ok: true,
    value: { ...draft, externalId: signal.externalId, cableId: match.cableId, faultNotBeforeMs: signal.faultNotBeforeMs, faultNotAfterMs: signal.faultNotAfterMs, windowFromMs: window.fromMs, windowToMs: window.toMs },
  };
}

async function processSource(source: PolledSource, database: SupabaseClient): Promise<Result<SourceOutcome>> {
  const outcome: SourceOutcome = { source, skipped: null, fetched: 0, fresh: 0, matched: 0, drafts: 0, stored: null };
  const fetched = await fetchSignals(source, database);
  if ("skipped" in fetched) return { ok: true, value: { ...outcome, skipped: fetched.skipped } };
  if (!fetched.ok) return fetched;
  outcome.fetched = fetched.value.length;
  if (fetched.value.length === 0) return { ok: true, value: outcome };
  const unseen = await database.rpc("unseen_fault_signal_ids", { signal_source: SIGNAL_SOURCES[source], external_ids: fetched.value.map((signal) => signal.externalId) });
  if (unseen.error) return { ok: false, reason: `unseen_fault_signal_ids failed: ${unseen.error.message}` };
  const unseenIds = new Set(Array.isArray(unseen.data) ? unseen.data.filter((id): id is string => typeof id === "string") : []);
  const fresh = fetched.value.filter((signal) => unseenIds.has(signal.externalId));
  outcome.fresh = fresh.length;
  if (fresh.length === 0) return { ok: true, value: outcome };
  const registry = await readRegistry(database, fresh.some((signal) => signal.locator.kind === "geometry"));
  if (!registry.ok) return registry;
  const matches: MatchRow[] = fresh.flatMap((signal) => matchSignalToCables(signal, registry.value).map((match) => ({ ...match, externalId: signal.externalId })));
  const matchedIds = new Set(matches.map((match) => match.externalId));
  const matchedSignals = fresh.filter((signal) => matchedIds.has(signal.externalId));
  outcome.matched = matchedSignals.length;
  const drafts: DraftRow[] = [];
  for (const match of matches.filter((candidate) => candidate.opensDraft)) {
    const signal = matchedSignals.find((candidate) => candidate.externalId === match.externalId);
    if (!signal) continue;
    const draft = await buildDraft(database, signal, match);
    if (!draft.ok) return draft;
    drafts.push(draft.value);
  }
  outcome.drafts = drafts.length;
  const stored = await database.rpc("store_fault_run", {
    run: { source: SIGNAL_SOURCES[source], processedIds: fresh.map((signal) => signal.externalId), signals: matchedSignals, matches, drafts },
  });
  if (stored.error) return { ok: false, reason: `store_fault_run failed: ${stored.error.message}` };
  return { ok: true, value: { ...outcome, stored: stored.data } };
}

function readSources(body: unknown): PolledSource[] | null {
  if (!isRecord(body) || !Array.isArray(body.sources) || body.sources.length === 0) return null;
  const sources = body.sources.filter((source): source is PolledSource => source === "nga" || source === "ioda" || source === "entsoe");
  return sources.length === body.sources.length ? [...new Set(sources)] : null;
}

Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("FAULT_SIGNALS_SECRET");
  const receivedSecret = request.headers.get("x-fault-signals-secret");
  if (!expectedSecret || !receivedSecret || !isSameSecret(receivedSecret, expectedSecret)) {
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const sources = readSources(body);
  if (!sources) return Response.json({ ok: false, reason: 'the body must be {"sources": ["nga" | "ioda" | "entsoe", ...]}' }, { status: 400 });
  const databaseResult = createDatabaseClient();
  if (!databaseResult.ok) {
    console.error(`[matchFaultSignals] ${databaseResult.reason}`);
    return Response.json({ ok: false, reason: databaseResult.reason }, { status: 500 });
  }
  const outcomes: SourceOutcome[] = [];
  const failures: string[] = [];
  for (const source of sources) {
    const outcome = await processSource(source, databaseResult.value);
    if (outcome.ok) outcomes.push(outcome.value);
    else failures.push(`${source}: ${outcome.reason}`);
  }
  for (const outcome of outcomes) {
    console.log(`[matchFaultSignals] ${outcome.source}: ${outcome.skipped ? `skipped (${outcome.skipped})` : `${outcome.fetched} signals, ${outcome.fresh} new, ${outcome.matched} matched, ${outcome.drafts} drafts`}`);
  }
  for (const failure of failures) console.error(`[matchFaultSignals] ${failure}`);
  return Response.json({ ok: failures.length === 0, outcomes, failures }, { status: failures.length === 0 ? 200 : 502 });
});
