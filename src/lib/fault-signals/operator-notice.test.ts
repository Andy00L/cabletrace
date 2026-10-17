import { describe, expect, test } from "bun:test";
import { signalFromOperatorNotice, type OperatorNoticeReading } from "./operator-notice";

const NOTICE = {
  url: "https://example.org/notice",
  publisher: "Grid operator",
  title: "Fault in the Link A connection",
  publishedAt: "2024-12-26T12:49:01+02:00",
  paragraphs: ["The Link A connection between Finland and Estonia disconnected after noon on Christmas Day."],
};
const READING: OperatorNoticeReading = {
  assetNames: ["Link A"],
  assetQuote: "Fault in the Link A connection",
  countries: ["FI", "EE"],
  countriesQuote: "between Finland and Estonia",
  faultNotBeforeUtc: "2024-12-25T10:00:00Z",
  faultNotAfterUtc: "2024-12-25T22:00:00Z",
  faultTimeQuote: "disconnected after noon on Christmas Day",
};

describe("signalFromOperatorNotice", () => {
  test("turns a notice and its reading into a power-link signal with the notice's span", () => {
    const signal = signalFromOperatorNotice(NOTICE, READING);
    if (!signal.ok) throw new Error(signal.reason);
    expect(signal.value.locator).toEqual({ kind: "asset", assetNames: ["Link A"], countries: ["FI", "EE"] });
    expect(signal.value.faultNotBeforeMs).toBe(Date.parse("2024-12-25T10:00:00Z"));
    expect(signal.value.publishedAtMs).toBe(Date.parse("2024-12-26T10:49:01Z"));
    expect(signal.value.title).toBe("Grid operator: Fault in the Link A connection");
  });

  test("refuses a reading whose quote the notice does not contain, or a reversed span", () => {
    expect(signalFromOperatorNotice(NOTICE, { ...READING, faultTimeQuote: "at 12:26" })).toEqual({ ok: false, reason: 'the notice does not say "at 12:26"' });
    expect(signalFromOperatorNotice(NOTICE, { ...READING, faultNotAfterUtc: "2024-12-24T00:00:00Z" }).ok).toBe(false);
    expect(signalFromOperatorNotice({ url: "x" }, READING).ok).toBe(false);
  });
});
