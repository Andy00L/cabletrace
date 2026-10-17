import type { Result } from "@/lib/result";
import { countryOfZone } from "@/lib/fault-signals/bidding-zones";
import { EXCERPT_MAX_CHARS, type FaultSignal } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readFiniteNumber, readIsoTime, readText } from "@/lib/fault-signals/read-json";

// Nord Pool urgent market messages (REMIT inside information), https://ummapi.nordpoolgroup.com, public, no key.
// Fingrid published Estlink 2's failure there first (message 79210ee1-3395-4f75-a972-7b03888b107a, version 2 at
// 11:01:34 UTC on 25 Dec 2024, saved in fixtures/nordpool-umm-estlink-2-v2.json): the same unplanned unavailability
// the ENTSO-E platform carries, readable without a token. The UMM terms and conditions were not read (the site links
// them from a script), so nothing polls this API on a schedule; the replay script reads the saved message.

const UMM_MESSAGE_URL = "https://umm.nordpoolgroup.com/#/messages";

// From the API: /infrastructure/unavailabilitytypes [{1, "Unplanned"}, {2, "Planned"}], /infrastructure/reasoncodes
// [{1, "Failure"}, {2, "Foreseen maintenance"}]. Message type 3 is the one that carries transmissionUnits (every
// type-3 message among the 50 newest on 17 Oct 2026 did, and no other type did).
const TRANSMISSION_MESSAGE = 3;
const UNPLANNED = 1;

/** One UMM version as a signal when it reports an unplanned transmission outage, or the reason it does not. */
export function parseUmmMessage(value: unknown): Result<FaultSignal> {
  if (!isRecord(value)) return { ok: false, reason: "the UMM message is not an object" };
  const messageId = readText(value.messageId);
  const version = readFiniteNumber(value.version);
  const startMs = readIsoTime(value.eventStart);
  const publishedMs = readIsoTime(value.publicationDate);
  if (messageId === null || version === null || startMs === null || publishedMs === null) return { ok: false, reason: "the UMM message lacks an id, a version or a time" };
  if (value.messageType !== TRANSMISSION_MESSAGE) return { ok: false, reason: `UMM ${messageId} is not a transmission message` };
  if (value.unavailabilityType !== UNPLANNED) return { ok: false, reason: `UMM ${messageId} is a planned unavailability` };
  const assets = Array.isArray(value.assets) ? value.assets : [];
  const assetNames = [...new Set(assets.flatMap((asset) => (isRecord(asset) && typeof asset.name === "string" ? [asset.name.trim()] : [])))];
  const units = Array.isArray(value.transmissionUnits) ? value.transmissionUnits : [];
  const firstUnit = units.find(isRecord);
  const outCountry = firstUnit ? countryOfZone(readText(firstUnit.outAreaEic) ?? "") : null;
  const inCountry = firstUnit ? countryOfZone(readText(firstUnit.inAreaEic) ?? "") : null;
  const countries: [string, string] | null = outCountry && inCountry && outCountry !== inCountry ? [outCountry, inCountry] : null;
  const publisher = readText(value.publisherName) ?? "a market participant";
  const reason = readText(value.unavailabilityReason);
  const remarks = readText(value.remarks);
  return {
    ok: true,
    value: {
      source: "nordpool-umm",
      externalId: `${messageId}:${version}`,
      kind: "power-link-failure",
      title: `Unplanned outage of ${assetNames.length > 0 ? assetNames.join(", ") : "a transmission link"}${countries ? ` between ${countries[0]} and ${countries[1]}` : ""}, reported by ${publisher} (Nord Pool UMM)`,
      faultNotBeforeMs: startMs,
      faultNotAfterMs: startMs,
      publishedAtMs: publishedMs,
      endsAtMs: readIsoTime(value.eventStop),
      locator: { kind: "asset", assetNames, countries },
      cableShip: null,
      sourceUrl: `${UMM_MESSAGE_URL}/${messageId}/${version}`,
      excerpt: [reason, remarks].filter((part) => part !== null).join(". ").slice(0, EXCERPT_MAX_CHARS),
    },
  };
}
