import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEntsoeOutageUrl, formatEntsoeTime, parseEntsoeOutages, parseOutageDocument } from "./entsoe-unavailability";
import { readZipEntries } from "./zip-entries";

// fixtures/entsoe-a78-unavailability.zip holds the documented A78 example of the ENTSO-E API collection (a cancelled,
// planned outage on the FR-BE border), a document constructed for these tests from the same structure with the values
// of Fingrid's market message on Estlink 2 (forced, failure), and a stored text entry.
const ZIP_BYTES = new Uint8Array(readFileSync(path.join(import.meta.dir, "fixtures/entsoe-a78-unavailability.zip")));
const encoder = new TextEncoder();

function readFixtureDocument(name: string): Promise<string> {
  return readZipEntries(ZIP_BYTES).then((entries) => {
    const entry = entries.ok ? entries.value.find((candidate) => candidate.name.startsWith(name)) : undefined;
    return entry ? new TextDecoder().decode(entry.bytes) : "";
  });
}

describe("readZipEntries", () => {
  test("reads deflated and stored entries by the central directory", async () => {
    const entries = await readZipEntries(ZIP_BYTES);
    if (!entries.ok) throw new Error(entries.reason);
    expect(entries.value.map((entry) => entry.name)).toEqual([
      "001-001-PLANNED_UNAVAIL_IN_TRANSMISSION_GRID_202307011430-202312311700.xml",
      "002-002-CABLETRACE_CONSTRUCTED_FORCED_ESTLINK_2.xml",
      "003-readme.txt",
    ]);
    expect(entries.value[0]?.bytes.length).toBe(13227);
    expect(new TextDecoder().decode(entries.value[2]?.bytes)).toContain("documented example");
  });

  test("refuses a cut archive", async () => {
    expect((await readZipEntries(ZIP_BYTES.slice(0, 900))).ok).toBe(false);
    expect((await readZipEntries(new Uint8Array(10))).ok).toBe(false);
  });
});

describe("parseEntsoeOutages", () => {
  test("keeps the forced outage of a DC link and skips the cancelled planned one", async () => {
    const parsed = await parseEntsoeOutages(ZIP_BYTES);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.skipped).toEqual(["A47mJe5e9jml9FeSL6jfKg is cancelled or withdrawn (A09)"]);
    expect(parsed.value.signals).toHaveLength(1);
    const [estlink] = parsed.value.signals;
    expect(estlink?.locator).toEqual({ kind: "asset", assetNames: ["Estlink 2"], countries: ["FI", "EE"] });
    expect(estlink?.faultNotBeforeMs).toBe(Date.parse("2024-12-25T10:26:00Z"));
    expect(estlink?.endsAtMs).toBe(Date.parse("2024-12-25T22:59:00Z"));
    expect(estlink?.externalId).toBe("CableTraceForcedEstlink2:1");
  });

  test("an empty answer is no signal; a refusal is a failure with ENTSO-E's reason", async () => {
    const acknowledgement = (reason: string) => encoder.encode(`<Acknowledgement_MarketDocument><Reason><code>999</code><text>${reason}</text></Reason></Acknowledgement_MarketDocument>`);
    expect(await parseEntsoeOutages(acknowledgement("No matching data found for Data item ..."))).toEqual({ ok: true, value: { signals: [], skipped: [] } });
    expect(await parseEntsoeOutages(acknowledgement("Authentication failed."))).toEqual({ ok: false, reason: "ENTSO-E refused the query: Authentication failed." });
    expect((await parseEntsoeOutages(encoder.encode("<html>busy</html>"))).ok).toBe(false);
  });
});

describe("parseOutageDocument", () => {
  test("a planned outage, a transformer and a withheld asset", async () => {
    const forced = await readFixtureDocument("002");
    expect(parseOutageDocument(forced.replace("<businessType>A54</businessType>", "<businessType>A53</businessType>"))).toEqual({ skipped: "CableTraceForcedEstlink2 is planned maintenance, not a forced outage" });
    expect(parseOutageDocument(forced.replace("<asset_PSRType.psrType>B22", "<asset_PSRType.psrType>B24"))).toEqual({ skipped: "CableTraceForcedEstlink2 concerns no AC or DC link" });
    const withheld = parseOutageDocument(forced.replace(/<Asset_RegisteredResource>[\s\S]*<\/Asset_RegisteredResource>/u, ""));
    expect("signal" in withheld ? withheld.signal.locator : null).toEqual({ kind: "asset", assetNames: [], countries: ["FI", "EE"] });
    expect("signal" in withheld ? withheld.signal.title : "").toBe("Unplanned outage of an undisclosed link between FI and EE (ENTSO-E)");
  });
});

describe("buildEntsoeOutageUrl", () => {
  test("asks for forced outages on one border, updated in the window", () => {
    const url = new URL(buildEntsoeOutageUrl({ token: "token-value", inDomain: "10Y1001A1001A39I", outDomain: "10YFI-1--------U", updatedFromMs: Date.parse("2024-12-25T09:00:00Z"), untilMs: Date.parse("2024-12-25T11:00:00Z") }));
    expect(url.searchParams.get("documentType")).toBe("A78");
    expect(url.searchParams.get("BusinessType")).toBe("A54");
    expect(url.searchParams.get("PeriodStartUpdate")).toBe("202412250900");
    expect(url.searchParams.get("periodStart")).toBe("202412240900");
    expect(url.searchParams.get("securityToken")).toBe("token-value");
    expect(formatEntsoeTime(Date.parse("2024-01-02T03:04:59Z"))).toBe("202401020304");
  });
});
