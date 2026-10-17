import { describe, expect, test } from "bun:test";
import { findCaseRegion, groupByCaseRegion } from "./case-regions";

describe("groupByCaseRegion", () => {
  test("groups in region order, keeps each group's order, drops empty regions and catches unknown areas", () => {
    const cases = [
      { slug: "matsu-case", area: "matsu" },
      { slug: "gulf-new", area: "gulf-of-finland" },
      { slug: "unknown", area: "somewhere-new" },
      { slug: "gulf-old", area: "gulf-of-finland-and-hiiumaa" },
    ];
    const groups = groupByCaseRegion(cases, (item) => item.area);
    expect(groups.map((group) => [group.region.id, group.items.map((item) => item.slug)])).toEqual([
      ["gulf-of-finland", ["gulf-new", "gulf-old"]],
      ["taiwan-strait", ["matsu-case"]],
      ["other", ["unknown"]],
    ]);
    expect(findCaseRegion("red-sea-south").name).toBe("Red Sea");
  });
});
