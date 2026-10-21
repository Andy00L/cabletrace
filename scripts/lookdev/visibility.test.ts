import { describe, expect, test } from "bun:test";
import { judgeSubjects, listCheckMoments, parseReportedSubjects, parseSafeArea } from "./visibility";

const SAFE_AREA = { left: 16, top: 72, right: 1016, bottom: 530 };

describe("judgeSubjects", () => {
  test("passes a subject inside the safe area and in sight, and names every other outcome", () => {
    const reported = [
      { name: "vessel", x: 540, y: 200, isHidden: false },
      { name: "anchor", x: 611, y: 560, isHidden: false },
      { name: "C-Lion1 cut point", x: 300, y: 300, isHidden: true },
      { name: "hawse (chain top)", x: null, y: null, isHidden: false },
    ];
    expect(judgeSubjects(["vessel", "anchor", "C-Lion1 cut point", "hawse (chain top)", "torn end west"], reported, SAFE_AREA)).toEqual([
      { name: "vessel", result: "visible" },
      { name: "anchor", result: "outside" },
      { name: "C-Lion1 cut point", result: "hidden" },
      { name: "hawse (chain top)", result: "outside" },
      { name: "torn end west", result: "missing" },
    ]);
  });
});

describe("listCheckMoments", () => {
  test("takes the drag's start and just after, each cut and its approach, and the drag's end, once each, inside the window", () => {
    const at = (clock: string) => Date.parse(`2024-12-25T${clock}Z`);
    const moments = listCheckMoments({
      windowStartMs: at("10:00:00"),
      windowEndMs: at("23:00:00"),
      dragWindow: { startMs: at("10:26:00"), endMs: at("16:45:00") },
      cuts: [{ atMs: at("10:26:30") }, { atMs: at("16:44:00") }],
    });
    expect(moments).toEqual([at("10:23:00"), at("10:26:00"), at("10:28:00"), at("16:41:00"), at("16:44:00"), at("16:45:00")]);
  });
});

describe("parsing the hooks", () => {
  test("keeps well-formed subjects and a whole safe area, and drops the rest", () => {
    expect(parseReportedSubjects('[{"name":"vessel","x":1,"y":2,"isHidden":false},{"name":3}]')).toEqual([{ name: "vessel", x: 1, y: 2, isHidden: false }]);
    expect(parseReportedSubjects("not json")).toEqual([]);
    expect(parseSafeArea('{"left":16,"top":72,"right":1016,"bottom":530}')).toEqual(SAFE_AREA);
    expect(parseSafeArea('{"left":16}')).toBeNull();
  });
});
