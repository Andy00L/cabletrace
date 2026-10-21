import { describe, expect, test } from "bun:test";
import { planViewReset } from "./view-reset";

describe("planViewReset", () => {
  test("turns the director off first, in every view, so the preset is not drawn over", () => {
    for (const view of ["overview", "top", "vessel", "closeup"] as const) {
      expect(planViewReset({ view, isDirectorOn: true, shipCamera: "follow" })).toEqual({ kind: "reset", releasesDirector: true, releasesShipCamera: false });
    }
  });

  test("puts a ship camera back to Follow in the Vessel view, with the director on or off", () => {
    expect(planViewReset({ view: "vessel", isDirectorOn: false, shipCamera: "bridge" })).toEqual({ kind: "reset", releasesDirector: false, releasesShipCamera: true });
    expect(planViewReset({ view: "vessel", isDirectorOn: true, shipCamera: "anchor" })).toEqual({ kind: "reset", releasesDirector: true, releasesShipCamera: true });
  });

  test("leaves a ship camera alone outside the Vessel view, where it holds nothing", () => {
    expect(planViewReset({ view: "top", isDirectorOn: false, shipCamera: "bridge" })).toEqual({ kind: "reset", releasesDirector: false, releasesShipCamera: false });
  });

  test("has nothing to reset on the follow camera, which takes no orbit or zoom", () => {
    expect(planViewReset({ view: "vessel", isDirectorOn: false, shipCamera: "follow" })).toEqual({ kind: "nothing-to-reset" });
  });
});
