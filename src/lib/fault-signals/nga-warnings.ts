import type { Result } from "@/lib/result";
import { EXCERPT_MAX_CHARS, type FaultSignal, type LonLatPair, type SignalGeometry, type SignalKind } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readFiniteNumber, readText } from "@/lib/fault-signals/read-json";

// NGA broadcast navigational warnings (https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active,
// public, no key): keeps the warnings about cable work or cable damage and reads their positions, the cable ship and
// the dates. Formats as read in the feed on 17 Oct 2026 (fixtures/nga-active-warnings-2026-10-17.json): positions
// "03-00.70N 006-57.40E" (degrees-minutes), lettered tracklines "A. ... B. ...", date-time groups "100559Z MAY 2024".
// That feed's newest warning is dated 10 May 2024 (its own /broadcast-warn/latest-warning endpoint says so).

export const NGA_ACTIVE_WARNINGS_URL = "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active";

// The fault behind a cable-work warning is not dated by the warning: repair ships sail days after a cut. The draft
// case looks at the ships near the cable during this span before the warning was issued (a stated assumption).
export const NGA_FAULT_LOOKBACK_MS = 72 * 60 * 60 * 1000;

// NGA's area codes as the warnings themselves name them ("CANCEL HYDROLANT 927/24", "CANCEL NAVAREA IV 489/24").
const AREA_NAMES: Readonly<Record<string, string>> = { A: "HYDROLANT", P: "HYDROPAC", C: "HYDROARC", "4": "NAVAREA IV", "12": "NAVAREA XII" };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Why a warning that mentions a cable is not a cable-work signal, or the kind of signal it is. */
export type WarningClass = { isKept: true; kind: SignalKind } | { isKept: false; reason: string };

// Checked in order; the first rule that matches decides. Survey ships "TOWING TEN 8100 METER LONG CABLES" tow seismic
// streamers, not subsea cables; a man overboard from a cable ship is a rescue; a standing prohibited area "DUE TO
// UNDERWATER CABLES ESTABLISHED" is a protection zone with no work going on.
const DROP_RULES: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\bTOWING\b.*\bCABLES?\b/u, reason: "a survey ship towing seismic streamers" },
  { pattern: /\b(MAN OVERBOARD|PERSONS? ON BOARD|MEDICAL EVACUATION|OVERDUE|ADRIFT|DISABLED)\b/u, reason: "a search and rescue message" },
  { pattern: /\bCABLES? (ESTABLISHED|AREA ESTABLISHED)\b/u, reason: "a standing cable protection area, no work or damage" },
];
const KEEP_RULES: readonly { pattern: RegExp; kind: SignalKind }[] = [
  { pattern: /\b(DAMAGED|BROKEN|SEVERED|FAULTY)( SUBMARINE| UNDERSEA| POWER| TELECOMMUNICATIONS?)? CABLES?\b|\bCABLES? (DAMAGE|FAULT|BREAK)\b/u, kind: "cable-damage" },
  { pattern: /\bCABLE REPAIRS?\b|\bREPAIR(ING)? (OF )?(THE )?(SUBMARINE |UNDERSEA )?CABLES?\b/u, kind: "cable-repair" },
  { pattern: /\bCABLE (OPERATIONS|LAYING|WORK|BURIAL|INSTALLATION)\b|\bCABLESHIP\b|\bCABLE SHIP\b/u, kind: "cable-operations" },
];

/** Joins the feed's fixed-width lines into one spaced line. */
function normaliseText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function classifyWarning(text: string): WarningClass {
  const line = normaliseText(text).toUpperCase();
  if (!/\bCABLE/u.test(line)) return { isKept: false, reason: "does not mention a cable" };
  for (const rule of DROP_RULES) if (rule.pattern.test(line)) return { isKept: false, reason: rule.reason };
  for (const rule of KEEP_RULES) if (rule.pattern.test(line)) return { isKept: true, kind: rule.kind };
  return { isKept: false, reason: "mentions a cable but no cable work or damage" };
}

// Degrees and decimal minutes, hemisphere letter after the minutes. The separator is a hyphen; one warning in the feed
// (HYDROPAC 1519/24) types "143.46.0E", so a full stop is accepted between degrees and minutes too.
const POSITION_PATTERN = /(\d{1,2})[-.](\d{1,2}(?:\.\d+)?)\s?([NS])\s+(\d{1,3})[-.](\d{1,2}(?:\.\d+)?)\s?([EW])/gu;

function toDegrees(degrees: string, minutes: string, hemisphere: string): number | null {
  const wholeDegrees = Number(degrees);
  const decimalMinutes = Number(minutes);
  if (!Number.isFinite(wholeDegrees) || !Number.isFinite(decimalMinutes) || decimalMinutes >= 60) return null;
  const value = wholeDegrees + decimalMinutes / 60;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

/** Every position in a piece of warning text, in order; malformed ones are skipped. */
export function parsePositions(text: string): LonLatPair[] {
  const positions: LonLatPair[] = [];
  for (const match of text.matchAll(POSITION_PATTERN)) {
    const [, latitudeDegrees, latitudeMinutes, latitudeHemisphere, longitudeDegrees, longitudeMinutes, longitudeHemisphere] = match;
    if (!latitudeDegrees || !latitudeMinutes || !latitudeHemisphere || !longitudeDegrees || !longitudeMinutes || !longitudeHemisphere) continue;
    const latitude = toDegrees(latitudeDegrees, latitudeMinutes, latitudeHemisphere);
    const longitude = toDegrees(longitudeDegrees, longitudeMinutes, longitudeHemisphere);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    positions.push([Math.round(longitude * 1e6) / 1e6, Math.round(latitude * 1e6) / 1e6]);
  }
  return positions;
}

// Where the geometry starts, and the words that end it (the berth request, or the next numbered paragraph).
const GEOMETRY_START = /\b(TRACKLINES? JOINING|AREAS? BOUND(ED)? BY|IN VICINITY)\b/u;
const GEOMETRY_END = /\b(WIDE BERTH|\w+ (MILE|METER) BERTH|BERTH REQUESTED)\b|\s\d\.\s/u;
// Lettered parts "A. 13-10.34N ..., B. 13-47.75N ...": a label of one to three capitals right before a position.
const PART_LABEL = /(?:^|\s)[A-Z]{1,3}\.\s+(?=\d{1,2}[-.]\d)/gu;

/** The trackline, area or points a cable warning gives, or null when it gives no position. */
export function parseWarningGeometry(text: string): SignalGeometry | null {
  const line = normaliseText(text).toUpperCase();
  const start = GEOMETRY_START.exec(line);
  const fromStart = start ? line.slice(start.index) : line;
  const end = GEOMETRY_END.exec(fromStart.slice(1));
  const geometryText = end ? fromStart.slice(0, end.index + 1) : fromStart;
  const parts = geometryText
    .split(PART_LABEL)
    .map(parsePositions)
    .filter((positions) => positions.length > 0);
  const allPositions = parts.flat();
  if (allPositions.length === 0) return null;
  const keyword = start?.[1] ?? "";
  if (keyword.startsWith("TRACKLINE") || /\bTRACKLINES? JOINING\b/u.test(geometryText)) {
    const lines = parts.filter((positions) => positions.length >= 2);
    return lines.length > 0 ? { kind: "tracklines", lines } : { kind: "points", points: allPositions };
  }
  if (keyword.startsWith("AREA") && allPositions.length >= 3) return { kind: "area", ring: allPositions };
  return { kind: "points", points: allPositions };
}

/** The vessel a warning says does the work: "BY CABLESHIP ILE DE SEIN", "BY M/V CASTORONE", "BY M/V HALL-1, M/V ABS". */
export function parseCableShip(text: string): string | null {
  const line = normaliseText(text).toUpperCase();
  const match = /\bBY (?:CABLESHIP|CABLE SHIP|C\/S|M\/V|MV|CS)\s+(.+?)(?=,|\.\s|\s(?:ALONG|IN AREA|IN VICINITY|IN POSITION|BETWEEN|TOWING|WITHIN)\b|$)/u.exec(line);
  return match?.[1]?.trim() || null;
}

/** "100559Z MAY 2024" or "210001Z AUG 23" as epoch milliseconds (UTC), or null. */
export function parseDateTimeGroup(value: string): number | null {
  const match = /^(\d{2})(\d{2})(\d{2})Z (\w{3}) (\d{2}|\d{4})$/u.exec(value.trim().toUpperCase());
  if (!match) return null;
  const [, day, hours, minutes, monthName, year] = match;
  const month = MONTHS.indexOf(monthName ?? "");
  if (!day || !hours || !minutes || !year || month < 0) return null;
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
  const atMs = Date.UTC(fullYear, month, Number(day), Number(hours), Number(minutes));
  return Number.isFinite(atMs) ? atMs : null;
}

/** "CANCEL THIS MSG 210001Z AUG 23": when the warning cancels itself, or null for "until further notice". */
function parseSelfCancel(text: string): number | null {
  const match = /CANCEL THIS MSG (\d{6}Z \w{3} \d{2,4})/u.exec(normaliseText(text).toUpperCase());
  return match?.[1] ? parseDateTimeGroup(match[1]) : null;
}

function describeArea(navArea: string, msgNumber: number, msgYear: number): string {
  return `${AREA_NAMES[navArea] ?? `NAVAREA ${navArea}`} ${msgNumber}/${String(msgYear).slice(-2)}`;
}

const LOWER_CASE_WORDS: ReadonlySet<string> = new Set(["of", "the", "and", "de", "del", "la"]);

/** "GULF OF GUINEA" as "Gulf of Guinea". */
function toPlaceCase(heading: string): string {
  return heading
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && LOWER_CASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** The warning's opening headings: the sea area and the country ("GULF OF GUINEA. NIGERIA." as "Gulf of Guinea, Nigeria"). */
function describePlace(text: string): string {
  const rows = text.split("\n").map((row) => row.trim());
  const headings: string[] = [];
  for (const row of rows) {
    if (!/^[A-Z][A-Z .'()-]*\.$/u.test(row)) break;
    headings.push(toPlaceCase(row.replace(/\.$/u, "")));
  }
  return headings.slice(0, 2).join(", ");
}

const KIND_WORDS: Readonly<Record<SignalKind, string>> = {
  "cable-damage": "Cable damage",
  "cable-repair": "Cable repair",
  "cable-operations": "Cable work",
  "power-link-failure": "Power link failure",
  "internet-outage": "Internet outage",
};

export type ParsedWarnings = { signals: FaultSignal[]; dropped: { externalId: string; reason: string }[] };

/** One warning of the feed as a signal, or the reason it is not one. */
export function parseWarning(value: unknown): { signal: FaultSignal } | { dropped: { externalId: string; reason: string } } | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === "string" ? value.text : null;
  const navArea = readText(value.navArea);
  const msgNumber = readFiniteNumber(value.msgNumber);
  const msgYear = readFiniteNumber(value.msgYear);
  const issuedAtMs = typeof value.issueDate === "string" ? parseDateTimeGroup(value.issueDate) : null;
  if (text === null || navArea === null || msgNumber === null || msgYear === null || issuedAtMs === null) return null;
  const externalId = describeArea(navArea, msgNumber, msgYear);
  const warningClass = classifyWarning(text);
  if (!warningClass.isKept) return { dropped: { externalId, reason: warningClass.reason } };
  const geometry = parseWarningGeometry(text);
  if (!geometry) return { dropped: { externalId, reason: "gives no position" } };
  const cableShip = parseCableShip(text);
  const place = describePlace(text);
  const searchParams = new URLSearchParams({ output: "json", navArea, msgYear: String(msgYear), msgNumber: String(msgNumber) });
  return {
    signal: {
      source: "nga-warning",
      externalId,
      kind: warningClass.kind,
      title: `${KIND_WORDS[warningClass.kind]}${cableShip ? ` by ${cableShip}` : ""}${place ? `, ${place}` : ""} (${externalId})`,
      faultNotBeforeMs: issuedAtMs - NGA_FAULT_LOOKBACK_MS,
      faultNotAfterMs: issuedAtMs,
      publishedAtMs: issuedAtMs,
      endsAtMs: parseSelfCancel(text),
      locator: { kind: "geometry", geometry },
      cableShip,
      sourceUrl: `https://msi.nga.mil/api/publications/broadcast-warn?${searchParams.toString()}`,
      excerpt: text.trim().slice(0, EXCERPT_MAX_CHARS),
    },
  };
}

/**
 * Parses the feed. One malformed warning fails the whole answer, so a format change is noticed instead of shrinking
 * the feed silently; warnings that are not about cable work are listed with the reason they were left out.
 */
export function parseNgaWarnings(payload: unknown): Result<ParsedWarnings> {
  if (!isRecord(payload) || !Array.isArray(payload["broadcast-warn"])) return { ok: false, reason: "the NGA answer has no broadcast-warn list" };
  const signals: FaultSignal[] = [];
  const dropped: { externalId: string; reason: string }[] = [];
  for (const warning of payload["broadcast-warn"]) {
    const parsed = parseWarning(warning);
    if (parsed === null) return { ok: false, reason: "the NGA answer has a malformed warning" };
    if ("signal" in parsed) signals.push(parsed.signal);
    else dropped.push(parsed.dropped);
  }
  return { ok: true, value: { signals, dropped } };
}
