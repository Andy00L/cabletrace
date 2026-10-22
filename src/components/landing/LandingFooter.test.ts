import { describe, expect, test } from "bun:test";
import { describeLandingRecord } from "@/components/landing/LandingFooter";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { HAI_HONG_GONG_66_2026 } from "@/data/cases/hai-hong-gong-66-2026";

describe("describeLandingRecord", () => {
  test("counts the cases, dates the newest from its first cut and states the watched lines", () => {
    const record = describeLandingRecord({ cases: [HAI_HONG_GONG_66_2026, EAGLE_S_2024], cablesWatched: 1204, regionCount: 8 });
    expect(record).toBe("2 cases on file, the newest on 30 Mar 2026. 1,204 cables and pipelines watched in 8 regions.");
  });

  test("drops the watched sentence when the recorder could not be read", () => {
    const record = describeLandingRecord({ cases: [EAGLE_S_2024], cablesWatched: null, regionCount: 8 });
    expect(record).toBe("1 case on file, the newest on 25 Dec 2024.");
  });

  test("collapses to null when nothing is known", () => {
    expect(describeLandingRecord({ cases: [], cablesWatched: null, regionCount: 8 })).toBeNull();
  });
});
