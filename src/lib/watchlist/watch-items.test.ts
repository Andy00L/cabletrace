import { describe, expect, test } from "bun:test";
import { isWatchUserId, parseWatchItemRow, parseWatchRequest } from "./watch-items";

describe("parseWatchRequest", () => {
  test("accepts a case slug, a nine-digit MMSI and a cable name, trimmed", () => {
    expect(parseWatchRequest({ kind: "case", ref: "eagle-s-2024", label: "Eagle S anchor drag" })).toEqual({ ok: true, value: { kind: "case", ref: "eagle-s-2024", label: "Eagle S anchor drag" } });
    expect(parseWatchRequest({ kind: "ship", ref: "518998900", label: "Eagle S" }).ok).toBe(true);
    expect(parseWatchRequest({ kind: "cable", ref: "  Estlink 2 ", label: "Estlink 2" })).toEqual({ ok: true, value: { kind: "cable", ref: "Estlink 2", label: "Estlink 2" } });
  });

  test("refuses what the table would refuse, each with its own reason", () => {
    expect(parseWatchRequest(null)).toEqual({ ok: false, reason: "the body must be a JSON object" });
    expect(parseWatchRequest({ kind: "pipeline", ref: "x", label: "x" }).ok).toBe(false);
    expect(parseWatchRequest({ kind: "ship", ref: "51899890", label: "Eagle S" })).toEqual({ ok: false, reason: "a ship ref is its nine-digit MMSI" });
    expect(parseWatchRequest({ kind: "case", ref: "Eagle S", label: "Eagle S" })).toEqual({ ok: false, reason: "a case ref is its slug" });
    expect(parseWatchRequest({ kind: "cable", ref: "Estlink\u00002", label: "Estlink 2" })).toEqual({ ok: false, reason: "ref contains control characters" });
    expect(parseWatchRequest({ kind: "cable", ref: "C".repeat(121), label: "C" })).toEqual({ ok: false, reason: "ref is longer than 120 characters" });
    expect(parseWatchRequest({ kind: "cable", ref: "Estlink 2", label: "   " })).toEqual({ ok: false, reason: "label is empty" });
  });
});

describe("parseWatchItemRow", () => {
  test("reads a PostgREST row and drops one that does not fit", () => {
    expect(parseWatchItemRow({ id: 7, kind: "cable", ref: "Estlink 2", label: "Estlink 2", created_at: "2026-10-17T16:00:00+00:00" })).toEqual({
      id: 7,
      kind: "cable",
      ref: "Estlink 2",
      label: "Estlink 2",
      createdAtMs: Date.parse("2026-10-17T16:00:00Z"),
    });
    expect(parseWatchItemRow({ id: "7", kind: "cable", ref: "Estlink 2", label: "Estlink 2", created_at: "2026-10-17T16:00:00+00:00" })).toBeNull();
    expect(parseWatchItemRow({ id: 7, kind: "cable", ref: "Estlink 2", label: "Estlink 2", created_at: "yesterday" })).toBeNull();
  });
});

describe("isWatchUserId", () => {
  test("accepts Supabase Auth's UUID user ids only", () => {
    expect(isWatchUserId("3f1c2a9e-5b7d-4e21-9c0a-8d6f4b2e1a07")).toBe(true);
    // A query-string trick and an id from the Clerk days are both refused.
    expect(isWatchUserId("3f1c2a9e-5b7d-4e21-9c0a-8d6f4b2e1a07&user_id=eq.other")).toBe(false);
    expect(isWatchUserId("user_2abcDEF123")).toBe(false);
    expect(isWatchUserId("")).toBe(false);
  });
});
