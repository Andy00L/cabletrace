import { describe, expect, test } from "bun:test";
import { findCaseProblems, toReplaySceneInput, type CableCase } from "./case-file";

// Test fixture only: shapes, not facts.
const CITATION = { sourceId: 1, quote: "A quote." };
const FIXTURE: CableCase = {
  slug: "fixture",
  title: "Fixture cable",
  subtitle: "Test data",
  summary: "Test data.",
  trackEvidence: "reconstruction",
  vessel: { name: "Vessel", flag: "Flag", type: "Tanker", imo: null, mmsi: null, citations: [CITATION] },
  window: { startUtc: "2024-12-25T08:00:00Z", endUtc: "2024-12-25T12:00:00Z" },
  localTime: { place: "Helsinki", timeZone: "Europe/Helsinki" },
  seabedArea: "gulf-of-finland",
  track: [
    { atUtc: "2024-12-25T09:00:00Z", longitude: 26, latitude: 60, precision: "area", place: "A", placement: "Fixture", citations: [CITATION] },
    { atUtc: "2024-12-25T11:00:00Z", longitude: 25.5, latitude: 59.9, precision: "named-place", place: "B", placement: "Fixture", citations: [CITATION] },
  ],
  dragWindow: { startUtc: "2024-12-25T09:30:00Z", endUtc: "2024-12-25T10:30:00Z", citations: [CITATION] },
  cuts: [{ cableName: "Line", label: "Line", owner: "Owner", atUtc: "2024-12-25T10:00:00Z", longitude: 25.8, latitude: 59.95, precision: "area", placement: "Fixture", citations: [CITATION] }],
  events: [{ atUtc: "2024-12-25T10:00:00Z", isTimeApproximate: false, kind: "cable-fault", title: "Fault", citations: [CITATION] }],
  aftermath: [{ atUtc: "2025-01-06T00:00:00Z", isTimeApproximate: true, kind: "court", title: "Ruling", citations: [CITATION] }],
  sources: [{ id: 1, publisher: "Publisher", title: "Title", url: "https://example.org", publishedOn: "2024-12-26" }],
};

describe("toReplaySceneInput", () => {
  test("converts times to milliseconds, sorts the track and labels a reconstruction", () => {
    const reversed = { ...FIXTURE, track: [...FIXTURE.track].reverse() };
    const input = toReplaySceneInput(reversed);
    expect(input.track.map((position) => position.atMs)).toEqual([Date.parse("2024-12-25T09:00:00Z"), Date.parse("2024-12-25T11:00:00Z")]);
    expect(input.cuts[0].atMs).toBe(Date.parse("2024-12-25T10:00:00Z"));
    expect(input.vessel.note).toBe("reconstructed position");
    expect(input.dragWindow?.endMs).toBe(Date.parse("2024-12-25T10:30:00Z"));
  });
});

describe("findCaseProblems", () => {
  test("passes a consistent case", () => {
    expect(findCaseProblems(FIXTURE)).toEqual([]);
  });

  test("reports missing sources, empty quotes, times outside the window and an unsorted track", () => {
    const broken: CableCase = {
      ...FIXTURE,
      vessel: { ...FIXTURE.vessel, citations: [] },
      track: [...FIXTURE.track].reverse(),
      events: [{ ...FIXTURE.events[0], atUtc: "2024-12-26T10:00:00Z", isTimeApproximate: false, kind: "cable-fault", title: "Late", citations: [{ sourceId: 9, quote: " " }] }],
      aftermath: [{ atUtc: "2024-12-25T10:00:00Z", isTimeApproximate: false, kind: "court", title: "Early", citations: [CITATION] }],
    };
    const problems = findCaseProblems(broken);
    expect(problems).toContain("vessel: no citation");
    expect(problems).toContain("track 1: earlier than the position before it");
    expect(problems).toContain('event "Late": 2024-12-26T10:00:00Z is outside the replay window');
    expect(problems).toContain('event "Late": cites missing source 9');
    expect(problems).toContain('event "Late": empty quote');
    expect(problems).toContain('aftermath "Early": 2024-12-25T10:00:00Z is not after the replay window');
  });
});
