import { describe, expect, test } from "bun:test";
import { formatConsoleState, formatMinute, parseConsoleState, toCutSlug, type ConsoleContext, type ConsoleState } from "./console-state";

const CONTEXT: ConsoleContext = {
  windowStartMs: Date.parse("2024-12-25T10:00:00Z"),
  windowEndMs: Date.parse("2024-12-25T23:00:00Z"),
  openingMs: Date.parse("2024-12-25T10:26:00Z"),
  cutSlugs: ["estlink-2", "c-lion1"],
  placementCount: 3,
  sourceIds: [1, 8, 31],
};

describe("toCutSlug", () => {
  test("lowercases and joins words with single hyphens", () => {
    expect(toCutSlug("C-Lion 1")).toBe("c-lion-1");
    expect(toCutSlug("  Estlink 2 ")).toBe("estlink-2");
  });
});

describe("parseConsoleState", () => {
  test("falls back to defaults for an empty or broken link", () => {
    const state = parseConsoleState({ t: "yesterday", view: "sideways", mode: "x", layer: "cut-nowhere" }, CONTEXT);
    expect(state).toEqual({ atMs: CONTEXT.openingMs, view: "overview", mode: "replay", detail: "illustrated", layer: { kind: "none" } });
  });

  test("reads a deep link to a cut card", () => {
    const state = parseConsoleState(new URLSearchParams("t=2024-12-25T16:44Z&view=closeup&layer=cut-c-lion1&mode=evidence&detail=measured"), CONTEXT);
    expect(state.atMs).toBe(Date.parse("2024-12-25T16:44:00Z"));
    expect(state.view).toBe("closeup");
    expect(state.mode).toBe("evidence");
    expect(state.detail).toBe("measured");
    expect(state.layer).toEqual({ kind: "cut", cutIndex: 1 });
  });

  test("clamps a time outside the window and rejects unknown sources and placements", () => {
    expect(parseConsoleState({ t: "2030-01-01T00:00Z" }, CONTEXT).atMs).toBe(CONTEXT.windowEndMs);
    expect(parseConsoleState({ layer: "source-99" }, CONTEXT).layer).toEqual({ kind: "none" });
    expect(parseConsoleState({ layer: "source-31" }, CONTEXT).layer).toEqual({ kind: "source", sourceId: 31 });
    expect(parseConsoleState({ layer: "placement-3" }, CONTEXT).layer).toEqual({ kind: "none" });
    expect(parseConsoleState({ layer: ["placement-2", "sources"] }, CONTEXT).layer).toEqual({ kind: "placement", positionIndex: 2 });
  });
});

describe("formatConsoleState", () => {
  test("a moment before the opening, such as the window start, keeps its time in the link", () => {
    const state: ConsoleState = { atMs: CONTEXT.windowStartMs, view: "overview", mode: "replay", detail: "illustrated", layer: { kind: "none" } };
    const query = formatConsoleState(state, CONTEXT);
    expect(query).toBe("t=2024-12-25T10:00Z");
    expect(parseConsoleState(new URLSearchParams(query), CONTEXT).atMs).toBe(CONTEXT.windowStartMs);
  });

  test("leaves out defaults and round-trips every layer", () => {
    const base: ConsoleState = { atMs: CONTEXT.openingMs, view: "overview", mode: "replay", detail: "illustrated", layer: { kind: "none" } };
    expect(formatConsoleState(base, CONTEXT)).toBe("");
    const layers: ConsoleState["layer"][] = [
      { kind: "vessel" },
      { kind: "cut", cutIndex: 0 },
      { kind: "placement", positionIndex: 1 },
      { kind: "source", sourceId: 8 },
      { kind: "sources" },
      { kind: "aftermath" },
      { kind: "shortcuts" },
    ];
    layers.forEach((layer) => {
      const state: ConsoleState = { ...base, atMs: Date.parse("2024-12-25T12:20:30Z"), view: "top", mode: "ship", layer };
      const reparsed = parseConsoleState(new URLSearchParams(formatConsoleState(state, CONTEXT)), CONTEXT);
      expect(reparsed).toEqual({ ...state, atMs: Date.parse("2024-12-25T12:20:00Z") });
    });
  });

  test("writes minutes in UTC", () => {
    expect(formatMinute(Date.parse("2024-12-25T16:44:59Z"))).toBe("2024-12-25T16:44Z");
  });
});
