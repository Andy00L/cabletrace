import { describe, expect, test } from "bun:test";
import { findLandingCountries, parseCountryShapes } from "@/lib/regions/landing-countries";

// Two square "countries" 0.1 degrees apart (about 6 km at 55 N), the western one with a lake.
const COUNTRIES = {
  type: "FeatureCollection",
  features: [
    {
      properties: { ISO_A2: "-99", ISO_A2_EH: "WE" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [[10, 55], [10.5, 55], [10.5, 55.5], [10, 55.5], [10, 55]],
          [[10.2, 55.2], [10.3, 55.2], [10.3, 55.3], [10.2, 55.3], [10.2, 55.2]],
        ],
      },
    },
    { properties: { ISO_A2_EH: "EA" }, geometry: { type: "MultiPolygon", coordinates: [[[[10.6, 55], [11, 55], [11, 55.5], [10.6, 55.5], [10.6, 55]]]] } },
    { properties: { ISO_A2_EH: "-99" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
  ],
};

describe("findLandingCountries", () => {
  const shapes = parseCountryShapes(COUNTRIES);

  test("parses two-letter codes only, from ISO_A2_EH", () => {
    expect(shapes.ok && shapes.value.map((shape) => shape.code)).toEqual(["WE", "EA"]);
  });

  test("lands on land, within 2 km of it, and nowhere for an end at sea or on a lake", () => {
    if (!shapes.ok) return;
    // On land in each, the cable across the strait.
    expect(findLandingCountries([[10.4, 55.1], [10.7, 55.1]], shapes.value)).toEqual(["EA", "WE"]);
    // 0.02 degrees east of the western shore: 1.3 km at sea, inside the reach.
    expect(findLandingCountries([[10.52, 55.1]], shapes.value)).toEqual(["WE"]);
    // Mid-strait, 3.2 km from either shore.
    expect(findLandingCountries([[10.55, 55.1]], shapes.value)).toEqual([]);
    // The middle of the lake, over 3 km from its shores.
    expect(findLandingCountries([[10.25, 55.25]], shapes.value)).toEqual([]);
  });
});
