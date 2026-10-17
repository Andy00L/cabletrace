import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/nordpool-umm-estlink-2-v2.json";
import { parseUmmMessage } from "./nordpool-umm";

// Fingrid's market message on Estlink 2, version 2, published 11:01:34 UTC on 25 Dec 2024 (fixtures/nordpool-umm-estlink-2-v2.json).

describe("parseUmmMessage", () => {
  test("reads the trip time, the link, the border and the publisher", () => {
    const parsed = parseUmmMessage(fixture.message);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.faultNotBeforeMs).toBe(Date.parse("2024-12-25T10:26:00Z"));
    expect(parsed.value.faultNotAfterMs).toBe(parsed.value.faultNotBeforeMs);
    expect(parsed.value.publishedAtMs).toBe(Date.parse("2024-12-25T11:01:34Z"));
    expect(parsed.value.locator).toEqual({ kind: "asset", assetNames: ["Estlink 2"], countries: ["FI", "EE"] });
    expect(parsed.value.title).toBe("Unplanned outage of Estlink 2 between FI and EE, reported by Fingrid Oyj (Nord Pool UMM)");
    expect(parsed.value.sourceUrl).toBe("https://umm.nordpoolgroup.com/#/messages/79210ee1-3395-4f75-a972-7b03888b107a/2");
    expect(parsed.value.excerpt).toBe("Failure. Estlink 2 trip");
  });

  test("a planned unavailability or a production message is not a fault signal", () => {
    expect(parseUmmMessage({ ...fixture.message, unavailabilityType: 2 }).ok).toBe(false);
    expect(parseUmmMessage({ ...fixture.message, messageType: 1 }).ok).toBe(false);
    expect(parseUmmMessage({ messageId: "x" }).ok).toBe(false);
  });
});
