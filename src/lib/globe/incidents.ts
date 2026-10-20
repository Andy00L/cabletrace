import type { CableCase } from "@/lib/cases/case-file";
import { formatMinute, toCutSlug } from "@/lib/console/console-state";
import { formatUtcDate } from "@/lib/replay/format-utc";

// The incidents on the /live globe: one marker per published case, at its primary cut (the first in `cuts`). Built
// on the server from CABLE_CASES so the page ships these few values, never the case files with their quotes.

export type GlobeIncident = {
  slug: string;
  title: string;
  vesselName: string;
  vesselType: string;
  vesselFlag: string;
  /** The primary cut: what was cut, when (UTC) and where. */
  cutLabel: string;
  cutAtMs: number;
  /** "25 Dec 2024" */
  dateLabel: string;
  longitude: number;
  latitude: number;
  /** The case console opened at the cut's minute with the cut's card open. */
  caseHref: string;
  /** Further cuts the same case records, for the card ("and 3 more cuts"). */
  otherCutCount: number;
  /** The case's seabed area, warmed while the camera dives (src/lib/seabed/warm-area.ts). */
  seabedArea: string;
};

/** One incident per case, newest cut first. */
export function toGlobeIncidents(cases: readonly CableCase[]): GlobeIncident[] {
  return cases
    .map((cableCase) => {
      const [primaryCut, ...otherCuts] = cableCase.cuts;
      const cutAtMs = Date.parse(primaryCut.atUtc);
      const query = new URLSearchParams({ t: formatMinute(cutAtMs), layer: `cut-${toCutSlug(primaryCut.label)}` });
      return {
        slug: cableCase.slug,
        title: cableCase.title,
        vesselName: cableCase.vessel.name,
        vesselType: cableCase.vessel.type,
        vesselFlag: cableCase.vessel.flag,
        cutLabel: primaryCut.label,
        cutAtMs,
        dateLabel: formatUtcDate(cutAtMs),
        longitude: primaryCut.longitude,
        latitude: primaryCut.latitude,
        // A colon is legal in a query string (RFC 3986, section 3.4), as formatConsoleState keeps it.
        caseHref: `/cases/${cableCase.slug}?${query.toString().replaceAll("%3A", ":")}`,
        otherCutCount: otherCuts.length,
        seabedArea: cableCase.seabedArea,
      };
    })
    .sort((first, second) => second.cutAtMs - first.cutAtMs);
}
