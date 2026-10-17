import type { Result } from "@/lib/result";
import type { FaultSignal } from "@/lib/fault-signals/fault-signal-types";
import { isRecord, readFiniteNumber, readText } from "@/lib/fault-signals/read-json";

// IODA outage alerts (Georgia Tech, https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts, public, no key).
// An alert is one data source of one country crossing IODA's threshold: level "critical" when the signal drops
// (condition "< 0.8" for active probing, "< 0.99" for BGP in the 17 Oct 2026 sample), "normal" when it recovers.
// Every answer says "This data is Copyright (c) 2021-2025 Georgia Tech Research Corporation. All Rights Reserved." and
// IODA publishes no redisplay terms (checked 17 Oct 2026): signals keep the country, the data source and the time,
// never IODA's values, and carry no excerpt. docs/FAULT_SIGNALS.md has the details.

export const IODA_ALERTS_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts";
const IODA_COUNTRY_PAGE = "https://ioda.inetintel.cc.gatech.edu/country";

// IODA bins its data in 5-minute (BGP) and 10-minute (active probing) steps, and the alert time is the end of the
// bin that crossed: the drop began up to one bin before. 10 minutes covers both.
const ALERT_BIN_MS = 10 * 60 * 1000;
const MS_PER_SECOND = 1000;

// IODA's names for the data sources that raise alerts, from its /v2/datasources/ answer of 17 Oct 2026.
const DATASOURCE_WORDS: Readonly<Record<string, string>> = {
  bgp: "BGP",
  "ping-slash24": "active probing",
  gtr: "Google Transparency Report",
  "gtr-sarima": "Google Transparency Report, forecasted",
  "gtr-norm": "Google Transparency Report, normalized",
  "merit-nt": "Merit network telescope",
};

/** The query for every country's alerts between two times (epoch milliseconds). */
export function buildIodaAlertsUrl(fromMs: number, untilMs: number): string {
  const searchParams = new URLSearchParams({
    from: String(Math.floor(fromMs / MS_PER_SECOND)),
    until: String(Math.floor(untilMs / MS_PER_SECOND)),
    entityType: "country",
  });
  return `${IODA_ALERTS_URL}?${searchParams.toString()}`;
}

type ParsedAlert = { country: string; countryName: string; datasource: string; atMs: number; level: string };

function parseAlert(value: unknown): ParsedAlert | null {
  if (!isRecord(value) || !isRecord(value.entity)) return null;
  const country = readText(value.entity.code);
  const countryName = readText(value.entity.name);
  const datasource = readText(value.datasource);
  const timeSeconds = readFiniteNumber(value.time);
  const level = readText(value.level);
  if (country === null || countryName === null || datasource === null || timeSeconds === null || level === null) return null;
  return { country: country.toUpperCase(), countryName, datasource, atMs: timeSeconds * MS_PER_SECOND, level };
}

/**
 * Turns an alerts answer into one signal per critical alert of a country. The recovery ("normal" alert) of the same
 * country and data source that follows ends it. Alerts for other entity types are not in a country query's answer.
 */
export function parseIodaAlerts(payload: unknown): Result<FaultSignal[]> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return { ok: false, reason: "the IODA answer has no data list" };
  const alerts: ParsedAlert[] = [];
  for (const value of payload.data) {
    const alert = parseAlert(value);
    if (alert === null) return { ok: false, reason: "the IODA answer has a malformed alert" };
    alerts.push(alert);
  }
  alerts.sort((first, second) => first.atMs - second.atMs);
  const signals = alerts.flatMap((alert, index): FaultSignal[] => {
    if (alert.level !== "critical") return [];
    const recovery = alerts.slice(index + 1).find((later) => later.level === "normal" && later.country === alert.country && later.datasource === alert.datasource);
    const sourceWords = DATASOURCE_WORDS[alert.datasource] ?? alert.datasource;
    return [
      {
        source: "ioda-alert",
        externalId: `${alert.country}:${alert.datasource}:${alert.atMs / MS_PER_SECOND}`,
        kind: "internet-outage",
        title: `Internet outage alert for ${alert.countryName} (IODA, ${sourceWords})`,
        faultNotBeforeMs: alert.atMs - ALERT_BIN_MS,
        faultNotAfterMs: alert.atMs,
        publishedAtMs: alert.atMs,
        endsAtMs: recovery?.atMs ?? null,
        locator: { kind: "country", country: alert.country },
        cableShip: null,
        sourceUrl: `${IODA_COUNTRY_PAGE}/${alert.country}`,
        excerpt: "",
      },
    ];
  });
  return { ok: true, value: signals };
}
