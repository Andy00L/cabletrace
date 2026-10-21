import { describe, expect, test } from "bun:test";
import { fitLabelInside } from "@/lib/seabed/scene/labels";

// A phone's stage: 358 px wide, labels kept 8 px inside it.
const BOUNDS = { left: 8, top: 8, right: 350, bottom: 442 };

describe("fitLabelInside", () => {
  test("slides a label cut by the right edge back inside (the phone's 'reconstructed position')", () => {
    expect(fitLabelInside({ left: 260, top: 200, right: 384, bottom: 216 }, BOUNDS)).toEqual({ shiftX: -34, shiftY: 0 });
  });

  test("slides from the left and top edges too, and leaves a label inside alone", () => {
    expect(fitLabelInside({ left: 2, top: 4, right: 80, bottom: 20 }, BOUNDS)).toEqual({ shiftX: 6, shiftY: 4 });
    expect(fitLabelInside({ left: 40, top: 40, right: 80, bottom: 56 }, BOUNDS)).toEqual({ shiftX: 0, shiftY: 0 });
  });

  test("hides a label mostly outside the stage rather than dragging it away from its point", () => {
    expect(fitLabelInside({ left: 320, top: 200, right: 420, bottom: 216 }, BOUNDS)).toBeNull();
  });
});
