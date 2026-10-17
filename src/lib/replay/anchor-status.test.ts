import { describe, expect, test } from "bun:test";
import { describeAnchorStatus } from "./anchor-status";

const DRAG = { dragWindow: { startMs: Date.parse("2024-12-25T10:26:00Z"), endMs: Date.parse("2024-12-25T16:45:00Z") } };

describe("describeAnchorStatus", () => {
  test("says when the drag starts, that it is under way, and when it ended", () => {
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T10:00:00Z"))).toEqual({ kind: "before", text: "Drag starts at 10:26" });
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T12:20:00Z"))).toEqual({ kind: "dragging", text: "Anchor dragging on the seabed" });
    expect(describeAnchorStatus(DRAG, Date.parse("2024-12-25T22:28:00Z"))).toEqual({ kind: "after", text: "Drag ended at 16:45" });
  });

  test("says so when the case has no drag", () => {
    expect(describeAnchorStatus({ dragWindow: null }, 0).kind).toBe("none");
  });
});
