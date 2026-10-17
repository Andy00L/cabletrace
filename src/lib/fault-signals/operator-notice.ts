import type { Result } from "@/lib/result";
import { EXCERPT_MAX_CHARS, type FaultSignal } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readIsoTime, readText } from "@/lib/fault-signals/read-json";

// A cable owner's or grid operator's own press notice (for example Fingrid's notice of 26 Dec 2024 on Estlink 2), saved
// as a fixture: { url, publisher, title, publishedAt, paragraphs }. A notice is prose, so a person reads it once and
// states what it says: the link it names, the countries it joins and the time span it gives for the fault, each with
// the words of the notice it comes from. The reading is refused unless every quote is in the notice word for word.

export type OperatorNoticeReading = {
  assetNames: string[];
  assetQuote: string;
  countries: [string, string];
  countriesQuote: string;
  /** The span the notice allows for the start of the fault, in UTC. */
  faultNotBeforeUtc: string;
  faultNotAfterUtc: string;
  faultTimeQuote: string;
};

type OperatorNotice = { url: string; publisher: string; title: string; publishedAtMs: number; paragraphs: string[] };

function parseNotice(value: unknown): OperatorNotice | null {
  if (!isRecord(value) || !Array.isArray(value.paragraphs)) return null;
  const url = readText(value.url);
  const publisher = readText(value.publisher);
  const title = readText(value.title);
  const publishedAtMs = readIsoTime(value.publishedAt);
  const paragraphs = value.paragraphs.flatMap((paragraph) => (typeof paragraph === "string" ? [paragraph] : []));
  if (url === null || publisher === null || title === null || publishedAtMs === null || paragraphs.length !== value.paragraphs.length) return null;
  return { url, publisher, title, publishedAtMs, paragraphs };
}

/** The notice as a power-link signal, after checking that the reading quotes the notice exactly. */
export function signalFromOperatorNotice(value: unknown, reading: OperatorNoticeReading): Result<FaultSignal> {
  const notice = parseNotice(value);
  if (notice === null) return { ok: false, reason: "the operator notice needs a url, publisher, title, publishedAt and paragraphs" };
  const fullText = [notice.title, ...notice.paragraphs].join("\n");
  const missingQuote = [reading.assetQuote, reading.countriesQuote, reading.faultTimeQuote].find((quote) => !fullText.includes(quote));
  if (missingQuote !== undefined) return { ok: false, reason: `the notice does not say "${missingQuote}"` };
  const faultNotBeforeMs = readIsoTime(reading.faultNotBeforeUtc);
  const faultNotAfterMs = readIsoTime(reading.faultNotAfterUtc);
  if (faultNotBeforeMs === null || faultNotAfterMs === null || faultNotAfterMs < faultNotBeforeMs) return { ok: false, reason: "the reading's fault span is not a valid time span" };
  return {
    ok: true,
    value: {
      source: "operator-notice",
      externalId: notice.url,
      kind: "power-link-failure",
      title: `${notice.publisher}: ${notice.title}`,
      faultNotBeforeMs,
      faultNotAfterMs,
      publishedAtMs: notice.publishedAtMs,
      endsAtMs: null,
      locator: { kind: "asset", assetNames: reading.assetNames, countries: reading.countries },
      cableShip: null,
      sourceUrl: notice.url,
      excerpt: notice.paragraphs.join("\n\n").slice(0, EXCERPT_MAX_CHARS),
    },
  };
}
