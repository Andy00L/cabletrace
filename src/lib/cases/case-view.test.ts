import { describe, expect, test } from "bun:test";
import { describeTrackEvidence, describeTrackEvidenceBriefly, formatPublishedDate, formatSourceNote, toTimelineEvents } from "./case-view";
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

describe("describeTrackEvidence", () => {
  const placed: CableCase["track"] = [
    { atUtc: "2024-11-18T02:04:00Z", longitude: 17, latitude: 55.9, precision: "area", place: "A", placement: "Fixture", citations: [{ sourceId: 1, quote: "q" }] },
  ];
  const recordedTrack: CableCase["recordedTrack"] = {
    selection: "Fixture",
    citations: [{ sourceId: 2, quote: "q" }],
    fixes: [{ atUtc: "2024-11-18T06:01:44Z", longitude: 16.3, latitude: 55.8, speedKnots: 7.3 }],
  };

  test("names a reconstruction, a recording, and the moment one hands over to the other", () => {
    expect(describeTrackEvidenceBriefly({ track: placed, recordedTrack: null })).toBe("Reconstructed from statements");
    expect(describeTrackEvidenceBriefly({ track: [], recordedTrack })).toBe("AIS reports");
    expect(describeTrackEvidenceBriefly({ track: placed, recordedTrack })).toBe("Reconstructed, then AIS from 06:01 UTC");
    expect(describeTrackEvidence({ track: placed, recordedTrack })).toStartWith("Until 06:01 UTC positions are reconstructed");
  });

  test("does not claim a handover when placed positions come after the recording starts", () => {
    const latePlaced: CableCase["track"] = [
      ...placed,
      { atUtc: "2024-11-18T09:00:00Z", longitude: 15.8, latitude: 55.7, precision: "area", place: "B", placement: "Fixture", citations: [{ sourceId: 1, quote: "q" }] },
    ];
    expect(describeTrackEvidenceBriefly({ track: latePlaced, recordedTrack })).toBe("Reconstructed and AIS");
  });
});
