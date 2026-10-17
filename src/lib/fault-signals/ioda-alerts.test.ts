import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/ioda-alerts-2026-10-15.json";
import { buildIodaAlertsUrl, parseIodaAlerts } from "./ioda-alerts";

// Every country's IODA alerts of 15 and 16 Oct 2026, as the API answered (fixtures/ioda-alerts-2026-10-15.json).

describe("parseIodaAlerts", () => {
  test("one signal per critical alert, ended by the recovery of the same country and data source", () => {
    const parsed = parseIodaAlerts(fixture);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value).toHaveLength(24);
    const namibia = parsed.value.find((signal) => signal.externalId === "NA:ping-slash24:1792110600");
    expect(namibia?.locator).toEqual({ kind: "country", country: "NA" });
    expect(namibia?.faultNotAfterMs).toBe(1792110600 * 1000);
    expect(namibia?.faultNotBeforeMs).toBe(1792110600 * 1000 - 10 * 60 * 1000);
    expect(namibia?.endsAtMs).toBe(1792119000 * 1000);
    expect(namibia?.title).toBe("Internet outage alert for Namibia (IODA, active probing)");
  });

  test("keeps none of IODA's values and no excerpt: no redisplay terms are published", () => {
    const parsed = parseIodaAlerts(fixture);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.every((signal) => signal.excerpt === "")).toBe(true);
    expect(parsed.value.some((signal) => /\d{3}/u.test(signal.title))).toBe(false);
  });

  test("a malformed alert fails the answer", () => {
    expect(parseIodaAlerts({ data: [{ level: "critical" }] }).ok).toBe(false);
    expect(parseIodaAlerts({ error: "down" }).ok).toBe(false);
  });
});

describe("buildIodaAlertsUrl", () => {
  test("asks for every country between two times in epoch seconds", () => {
    expect(buildIodaAlertsUrl(1_792_108_800_000, 1_792_110_600_999)).toBe(
      "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=1792108800&until=1792110600&entityType=country",
    );
  });
});
