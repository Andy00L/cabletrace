import { describe, expect, test } from "bun:test";
import { describeFlag, readFlagFromMmsi } from "./ship-identity";

describe("readFlagFromMmsi", () => {
  test("reads the administration from a ship station's first three digits", () => {
    // Eagle S, MMSI 518998865, Cook Islands flag (src/data/cases/eagle-s-2024.ts); Yi Peng 3, MMSI 414270000, China.
    expect(readFlagFromMmsi(518998865)).toEqual({ kind: "flag", mid: 518, administration: "New Zealand - Cook Islands" });
    expect(describeFlag(readFlagFromMmsi(414270000))).toBe("China (People's Republic of), MID 414");
    expect(readFlagFromMmsi(230123456)).toMatchObject({ kind: "flag", administration: "Finland" });
  });

  test("keeps every MID of an administration listed together by ITU", () => {
    expect(readFlagFromMmsi(637000001)).toMatchObject({ kind: "flag", administration: "Liberia (Republic of)" });
    expect(readFlagFromMmsi(374000001)).toMatchObject({ kind: "flag", administration: "Panama (Republic of)" });
  });

  test("names no flag for digits ITU has not assigned or for other kinds of station", () => {
    expect(readFlagFromMmsi(200000001)).toEqual({ kind: "unassigned", mid: 200 });
    expect(describeFlag(readFlagFromMmsi(992301234))).toBeNull();
    expect(readFlagFromMmsi(2301234)).toEqual({ kind: "not-a-ship-station" });
  });
});
