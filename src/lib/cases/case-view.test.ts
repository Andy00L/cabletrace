import { describe, expect, test } from "bun:test";
import { formatPublishedDate, formatSourceNote, toTimelineEvents } from "./case-view";
import type { CableCase } from "./case-file";

describe("formatSourceNote", () => {
  test("lists each source once, in first-cited order", () => {
    expect(formatSourceNote([{ sourceId: 31, quote: "a" }, { sourceId: 36, quote: "b" }, { sourceId: 31, quote: "c" }])).toBe("Sources 31, 36");
    expect(formatSourceNote([{ sourceId: 19, quote: "a" }])).toBe("Source 19");
  });
});

describe("formatPublishedDate", () => {
  test("formats an ISO date and leaves free text alone", () => {
    expect(formatPublishedDate("2024-12-26")).toBe("26 Dec 2024");
    expect(formatPublishedDate("read 17 Oct 2026")).toBe("read 17 Oct 2026");
  });
});

describe("toTimelineEvents", () => {
  test("sorts by time and labels each event in UTC", () => {
    const events: CableCase["events"] = [
      { atUtc: "2024-12-25T16:44:00Z", isTimeApproximate: false, kind: "cable-fault", title: "Second", citations: [{ sourceId: 19, quote: "q" }] },
      { atUtc: "2024-12-25T10:26:00Z", isTimeApproximate: true, kind: "cable-fault", title: "First", citations: [{ sourceId: 15, quote: "q" }] },
    ];
    const timeline = toTimelineEvents({ events });
    expect(timeline.map((event) => [event.title, event.timeLabel, event.isTimeApproximate])).toEqual([
      ["First", "10:26", true],
      ["Second", "16:44", false],
    ]);
  });
});
