import { describe, expect, test } from "bun:test";
import { describeAnchorStatus } from "./anchor-status";

const DRAG = { dragWindow: { startMs: Date.parse("2024-12-25T10:26:00Z"), endMs: Date.parse("2024-12-25T16:45:00Z") }, track: [] };

describe("describeAnchorStatus", () => {
  test("says when the drag starts, that it is under way, and when it ended", () => {
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T10:00:00Z"))).toEqual({ kind: "before", text: "Drag starts at 10:26" });
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T12:20:00Z"))).toEqual({ kind: "dragging", text: "Anchor dragging on the seabed" });
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T22:28:00Z"))).toEqual({ kind: "after", text: "Drag ended at 16:45" });
  });

  test("says so when the case has no drag", () => {
    expect(describeAnchorStatus({ dragWindow: null, track: [] }, 0)).toEqual({ kind: "none", text: "No anchor drag in this case" });
  });

  test("says the ship is held while the sources place it on one point (Hai Hong Gong 66 at the wreck)", () => {
    const track = [
      { atMs: Date.parse("2026-03-30T11:00:00Z"), longitude: 120.49129, latitude: 26.374, recordedSpeedKnots: null },
      { atMs: Date.parse("2026-03-30T18:00:00Z"), longitude: 120.49129, latitude: 26.374, recordedSpeedKnots: null },
    ];
    expect(describeAnchorStatus({ dragWindow: null, track }, Date.parse("2026-03-30T14:35:00Z")).text).toBe("Ship held at one point, no anchor drag");
    expect(describeAnchorStatus({ dragWindow: null, track }, Date.parse("2026-03-30T09:00:00Z")).text).toBe("No anchor drag in this case");
  });
});
