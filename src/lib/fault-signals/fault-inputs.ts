import type { Result } from "@/lib/result";
import { parseDetectionInputs, type ShipTrack } from "@/lib/detection/detection-inputs";
import type { CableKind, CableLine } from "@/lib/detection/detection-types";
import type { PassingShip } from "@/lib/fault-signals/draft-case";
import type { LonLatPair, RegistryCable } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readFiniteNumber, readText } from "@/lib/fault-signals/read-json";

// Parsers for the two payloads the match-fault-signals edge function reads from the database
// (supabase/migrations/20261019300000_fault_signals.sql): the registry cables for the matcher
// (public.fault_match_inputs) and the recorded ships near one cable for a draft case (public.fault_case_inputs).
// Validated once here where they enter; one malformed row fails the payload rather than shrinking it.

const CABLE_KINDS: readonly CableKind[] = ["power", "telecom", "pipeline"];

function isCableKind(value: unknown): value is CableKind {
  return CABLE_KINDS.some((kind) => kind === value);
}

function parsePair(value: unknown): LonLatPair | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = readFiniteNumber(value[0]);
  const latitude = readFiniteNumber(value[1]);
  return longitude === null || latitude === null ? null : [longitude, latitude];
}

/** A GeoJSON LineString or MultiLineString as its parts; null when malformed. */
function parseRouteParts(route: unknown): LonLatPair[][] | null {
  if (!isRecord(route) || !Array.isArray(route.coordinates)) return null;
  const rawParts: unknown[] = route.type === "MultiLineString" ? route.coordinates : route.type === "LineString" ? [route.coordinates] : [];
  const parts: LonLatPair[][] = [];
  for (const rawPart of rawParts) {
    if (!Array.isArray(rawPart)) return null;
    const pairs = rawPart.map(parsePair);
    const validPairs = pairs.filter((pair): pair is LonLatPair => pair !== null);
    if (validPairs.length !== pairs.length) return null;
    if (validPairs.length >= 2) parts.push(validPairs);
  }
  return parts;
}

/**
 * public.fault_match_inputs(): {cables: [{id, name, kind, countries, route?}]}. Without routes (the database leaves
 * them out when no signal needs geometry) every cable has no lines, and only name and country matching can run.
 */
export function parseMatchInputs(payload: unknown): Result<RegistryCable[]> {
  if (!isRecord(payload) || !Array.isArray(payload.cables)) return { ok: false, reason: "fault match inputs need a cables array" };
  const cables: RegistryCable[] = [];
  for (const value of payload.cables) {
    if (!isRecord(value)) return { ok: false, reason: "fault match inputs have a malformed cable" };
    const id = readFiniteNumber(value.id);
    const name = readText(value.name);
    const countries = Array.isArray(value.countries) ? value.countries.flatMap((country) => (typeof country === "string" && /^[A-Z]{2}$/u.test(country) ? [country] : [])) : null;
    const lines = value.route === undefined || value.route === null ? [] : parseRouteParts(value.route);
    if (id === null || name === null || !isCableKind(value.kind) || countries === null || lines === null) return { ok: false, reason: "fault match inputs have a malformed cable" };
    cables.push({ id, name, kind: value.kind, lines, countries });
  }
  return { ok: true, value: cables };
}

export type FaultCaseInputs = { candidates: ShipTrack[]; cable: CableLine[]; passers: PassingShip[]; names: Map<number, string> };

const MS_PER_SECOND = 1000;
// One passer-by row: [mmsi, epoch seconds, distance to the cable in metres, speed in knots or null].
const PASSER_ROW_LENGTH = 4;

function parsePasser(value: unknown): PassingShip | null {
  if (!Array.isArray(value) || value.length !== PASSER_ROW_LENGTH) return null;
  const mmsi = readFiniteNumber(value[0]);
  const epochSeconds = readFiniteNumber(value[1]);
  const distanceMetres = readFiniteNumber(value[2]);
  const speedKnots = readFiniteNumber(value[3]);
  if (mmsi === null || epochSeconds === null || distanceMetres === null || (speedKnots === null && value[3] !== null)) return null;
  return { mmsi, atMs: epochSeconds * MS_PER_SECOND, distanceMetres, speedKnots };
}

/**
 * public.fault_case_inputs(): the detector's payload shape (positions, vessels, cables, read by parseDetectionInputs)
 * for the ships that can be judged, plus `passersBy` rows for the ships that never entered the drag speed band.
 */
export function parseFaultCaseInputs(payload: unknown): Result<FaultCaseInputs> {
  const detectionInputs = parseDetectionInputs(payload);
  if (!detectionInputs.ok) return detectionInputs;
  if (!isRecord(payload) || !Array.isArray(payload.passersBy) || !Array.isArray(payload.vessels)) return { ok: false, reason: "fault case inputs need passersBy and vessels arrays" };
  const passers: PassingShip[] = [];
  for (const row of payload.passersBy) {
    const passer = parsePasser(row);
    if (passer === null) return { ok: false, reason: "fault case inputs have a malformed passer-by" };
    passers.push(passer);
  }
  const names = new Map<number, string>();
  for (const vessel of payload.vessels) {
    if (!isRecord(vessel)) continue;
    const mmsi = readFiniteNumber(vessel.mmsi);
    const name = readText(vessel.name);
    if (mmsi !== null && name !== null) names.set(mmsi, name);
  }
  return { ok: true, value: { candidates: detectionInputs.value.tracks, cable: detectionInputs.value.cables, passers, names } };
}
