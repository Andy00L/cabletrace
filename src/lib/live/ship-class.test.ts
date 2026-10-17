import { describe, expect, test } from "bun:test";
import { shipClassFromAisType } from "./ship-class";

describe("shipClassFromAisType", () => {
  test("follows ITU-R M.1371-5 Table 53", () => {
    const classByType = Object.fromEntries(
      [null, 0, 20, 30, 31, 32, 33, 35, 36, 37, 50, 52, 55, 60, 69, 70, 79, 80, 89, 90, 99, 255, 256, -1].map((aisType) => [
        String(aisType),
        shipClassFromAisType(aisType),
      ]),
    );
    expect(classByType).toEqual({
      null: "unknown",
      "0": "unknown",
      "20": "other",
      "30": "fishing",
      "31": "tug",
      "32": "tug",
      "33": "other",
      "35": "military",
      "36": "sailing",
      "37": "pleasure",
      "50": "pilot",
      "52": "tug",
      "55": "other",
      "60": "passenger",
      "69": "passenger",
      "70": "cargo",
      "79": "cargo",
      "80": "tanker",
      "89": "tanker",
      "90": "other",
      "99": "other",
      "255": "other",
      "256": "unknown",
      "-1": "unknown",
    });
  });
});
