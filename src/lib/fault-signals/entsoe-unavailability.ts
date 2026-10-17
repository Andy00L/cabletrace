import type { Result } from "@/lib/result";
import { countryOfZone } from "@/lib/fault-signals/bidding-zones";
import { EXCERPT_MAX_CHARS, type FaultSignal } from "@/lib/fault-signals/fault-signal-types";
import { isZipArchive, readZipEntries } from "@/lib/fault-signals/zip-entries";

// ENTSO-E Transparency Platform, "Unavailability of Transmission Infrastructure" [10.1.A&B], documentType A78. The
// API needs a free security token (ENTSO_E_TOKEN); without one it answers 401 "Authentication failed." (measured
// 17 Oct 2026). Element names follow the documented example of the ENTSO-E RESTful API collection
// (https://documenter.getpostman.com/view/7009892/2s93JtP3F6, request "10.1.A&B Unavailability of Transmission
// Infrastructure", read 17 Oct 2026), saved in fixtures/entsoe-a78-unavailability.zip. Only forced outages (A54) of
// AC or DC links (B21, B22) become signals: planned maintenance is not a fault, and a transformer is not a cable.

export const ENTSOE_API_URL = "https://web-api.tp.entsoe.eu/api";
export const ENTSOE_PLATFORM_URL = "https://transparency.entsoe.eu/";

// Codes of the API collection's parameter notes: businessType "A53 = Planned maintenance; A54 = Forced unavailability
// (unplanned outage)"; DocStatus "A05 = Active, A09 = Cancelled, A13 = Withdrawn". Asset types from the platform's
// PsrType article (transparencyplatform.zendesk.com, article 15856995130004): "B21 AC Link", "B22 DC Link".
const FORCED_OUTAGE = "A54";
const WITHDRAWN_STATUSES: ReadonlySet<string> = new Set(["A09", "A13"]);
const LINK_ASSET_TYPES: ReadonlySet<string> = new Set(["B21", "B22"]);
const MS_PER_HOUR = 3_600_000;

/** The query for the forced outages on one border, published or updated in [updatedFromMs, untilMs]. */
export function buildEntsoeOutageUrl(input: { token: string; inDomain: string; outDomain: string; updatedFromMs: number; untilMs: number }): string {
  const searchParams = new URLSearchParams({
    securityToken: input.token,
    documentType: "A78",
    BusinessType: FORCED_OUTAGE,
    In_Domain: input.inDomain,
    Out_Domain: input.outDomain,
    // periodStart and periodEnd are mandatory and bound the outage itself; a day either side of the update window
    // keeps every outage that started recently or is still running.
    periodStart: formatEntsoeTime(input.updatedFromMs - 24 * MS_PER_HOUR),
    periodEnd: formatEntsoeTime(input.untilMs + 24 * MS_PER_HOUR),
    PeriodStartUpdate: formatEntsoeTime(input.updatedFromMs),
    PeriodEndUpdate: formatEntsoeTime(input.untilMs),
  });
  return `${ENTSOE_API_URL}?${searchParams.toString()}`;
}

/** "yyyyMMddHHmm" in UTC, the API's time pattern. */
export function formatEntsoeTime(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 16).replace(/[-:T]/gu, "");
}

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/gu, (entity) => ENTITIES[entity] ?? entity);
}

function escapeForPattern(tag: string): string {
  return tag.replace(/[.]/gu, "\\.");
}

/** The inner XML of every <tag> element, in order. The A78 schema never nests an element in one of its own name. */
function readBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${escapeForPattern(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeForPattern(tag)}>`, "gu");
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** The trimmed text of the first <tag> element, or null. */
function readValue(xml: string, tag: string): string | null {
  const [block] = readBlocks(xml, tag);
  if (block === undefined) return null;
  const text = decodeEntities(block.trim());
  return text === "" ? null : text;
}

type OutageAsset = { name: string | null; type: string | null; location: string | null };

/** One Unavailability_MarketDocument as a signal, or the reason it is not one (null reason: not an outage document). */
export function parseOutageDocument(xmlText: string): { signal: FaultSignal } | { skipped: string } {
  const xml = xmlText.replace(/<!--[\s\S]*?-->/gu, "");
  if (!/<Unavailability_MarketDocument[\s>]/u.test(xml)) return { skipped: "not an unavailability document" };
  const documentId = readValue(xml, "mRID");
  const revision = readValue(xml, "revisionNumber") ?? "1";
  const status = readValue(readBlocks(xml, "docStatus")[0] ?? "", "value");
  const createdMs = Date.parse(readValue(xml, "createdDateTime") ?? "");
  if (documentId === null || !Number.isFinite(createdMs)) return { skipped: "an outage document without an id or a creation time" };
  if (status !== null && WITHDRAWN_STATUSES.has(status)) return { skipped: `${documentId} is cancelled or withdrawn (${status})` };
  const series = readBlocks(xml, "TimeSeries");
  const forced = series.filter((block) => readValue(block, "businessType") === FORCED_OUTAGE);
  if (forced.length === 0) return { skipped: `${documentId} is planned maintenance, not a forced outage` };
  const assets: OutageAsset[] = forced.flatMap((block) =>
    readBlocks(block, "Asset_RegisteredResource").map((asset) => ({
      name: readValue(asset, "name"),
      type: readValue(asset, "asset_PSRType.psrType"),
      location: readValue(asset, "location.name"),
    })),
  );
  const links = assets.filter((asset) => asset.type === null || LINK_ASSET_TYPES.has(asset.type));
  // TR article 10.4 lets a TSO withhold the asset; then the border alone says which links it can be.
  if (assets.length > 0 && links.length === 0) return { skipped: `${documentId} concerns no AC or DC link` };
  const firstSeries = forced[0] ?? "";
  const startMs = Date.parse(`${readValue(firstSeries, "start_DateAndOrTime.date") ?? ""}T${readValue(firstSeries, "start_DateAndOrTime.time") ?? ""}`);
  const endMs = Date.parse(`${readValue(firstSeries, "end_DateAndOrTime.date") ?? ""}T${readValue(firstSeries, "end_DateAndOrTime.time") ?? ""}`);
  if (!Number.isFinite(startMs)) return { skipped: `${documentId} has no readable start` };
  const inCountry = countryOfZone(readValue(firstSeries, "in_Domain.mRID") ?? "");
  const outCountry = countryOfZone(readValue(firstSeries, "out_Domain.mRID") ?? "");
  const countries: [string, string] | null = inCountry && outCountry && inCountry !== outCountry ? [outCountry, inCountry] : null;
  const assetNames = [...new Set(links.flatMap((asset) => (asset.name ? [asset.name] : [])))];
  const reasonText = readValue(readBlocks(xml, "Reason")[0] ?? "", "text");
  const linkWords = assetNames.length > 0 ? assetNames.join(", ") : "an undisclosed link";
  const borderWords = countries ? ` between ${countries[0]} and ${countries[1]}` : "";
  return {
    signal: {
      source: "entsoe-unavailability",
      externalId: `${documentId}:${revision}`,
      kind: "power-link-failure",
      title: `Unplanned outage of ${linkWords}${borderWords} (ENTSO-E)`,
      faultNotBeforeMs: startMs,
      faultNotAfterMs: startMs,
      publishedAtMs: createdMs,
      endsAtMs: Number.isFinite(endMs) ? endMs : null,
      locator: { kind: "asset", assetNames, countries },
      cableShip: null,
      sourceUrl: ENTSOE_PLATFORM_URL,
      excerpt: [reasonText, ...links.flatMap((asset) => (asset.location ? [asset.location] : []))].filter((part) => part !== null).join(". ").slice(0, EXCERPT_MAX_CHARS),
    },
  };
}

export type ParsedOutages = { signals: FaultSignal[]; skipped: string[] };

/**
 * Parses an A78 answer: a ZIP of outage documents, or one XML document. An Acknowledgement_MarketDocument (the API's
 * answer when nothing matches, or when the request is refused) carries its reason text back as a failure, except
 * "No matching data found", which is an empty answer.
 */
export async function parseEntsoeOutages(bytes: Uint8Array): Promise<Result<ParsedOutages>> {
  const documents: string[] = [];
  if (isZipArchive(bytes)) {
    const entries = await readZipEntries(bytes);
    if (!entries.ok) return entries;
    documents.push(...entries.value.filter((entry) => entry.name.toLowerCase().endsWith(".xml")).map((entry) => new TextDecoder().decode(entry.bytes)));
  } else {
    const text = new TextDecoder().decode(bytes);
    if (/<Acknowledgement_MarketDocument[\s>]/u.test(text)) {
      const reason = readValue(readBlocks(text, "Reason")[0] ?? "", "text") ?? "no reason given";
      return /no matching data/iu.test(reason) ? { ok: true, value: { signals: [], skipped: [] } } : { ok: false, reason: `ENTSO-E refused the query: ${reason}` };
    }
    if (!/<Unavailability_MarketDocument[\s>]/u.test(text)) return { ok: false, reason: "ENTSO-E answered neither a ZIP, an outage document nor an acknowledgement" };
    documents.push(text);
  }
  const signals: FaultSignal[] = [];
  const skipped: string[] = [];
  for (const document of documents) {
    const parsed = parseOutageDocument(document);
    if ("signal" in parsed) signals.push(parsed.signal);
    else skipped.push(parsed.skipped);
  }
  return { ok: true, value: { signals, skipped } };
}
