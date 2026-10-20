import { describe, expect, test } from "bun:test";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { SVALBARD_2022 } from "@/data/cases/svalbard-2022";
import { VEZHEN_2025 } from "@/data/cases/vezhen-2025";
import { YI_PENG_3_2024 } from "@/data/cases/yi-peng-3-2024";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { readAisMoment, readAisSignal } from "@/lib/console/ais-signal";

const at = (isoUtc: string) => Date.parse(isoUtc);

describe("readAisSignal", () => {
  test("Yi Peng 3: 114 reports, silences of 15, 15 and 50 minutes, placed from statements until 06:01", () => {
    const signal = readAisSignal(toReplaySceneInput(YI_PENG_3_2024).track);
    if (signal.kind !== "recorded") throw new Error(`expected recorded AIS, got ${signal.kind}`);
    expect(signal.reportTimesMs).toHaveLength(114);
    expect(signal.gaps.map((gap) => gap.minutes)).toEqual([15, 15, 50]);
    expect(signal.gaps[2]).toEqual({ startMs: at("2024-11-18T06:35:54Z"), endMs: at("2024-11-18T07:25:55Z"), minutes: 50 });
    expect(signal.reconstructed).toEqual([{ startMs: at("2024-11-17T07:55:00Z"), endMs: at("2024-11-18T06:01:44Z") }]);
    expect(signal.axis).toEqual({ startMs: at("2024-11-18T06:00:00Z"), endMs: at("2024-11-18T11:00:00Z") });
  });

  test("Vezhen: the two silences its archive header names, between the kept fixes around 17:07 to 17:17 and 18:23 to 18:39", () => {
    const signal = readAisSignal(toReplaySceneInput(VEZHEN_2025).track);
    if (signal.kind !== "recorded") throw new Error(`expected recorded AIS, got ${signal.kind}`);
    expect(signal.gaps.map((gap) => [new Date(gap.startMs).toISOString().slice(11, 16), new Date(gap.endMs).toISOString().slice(11, 16)])).toEqual([
      ["17:06", "17:17"],
      ["18:22", "18:39"],
    ]);
  });

  test("a feed sampled every 5 minutes reads no silence where no kept fix is more than 6 minutes apart (Svalbard)", () => {
    const signal = readAisSignal(toReplaySceneInput(SVALBARD_2022).track);
    if (signal.kind !== "recorded") throw new Error(`expected recorded AIS, got ${signal.kind}`);
    expect(signal.gapThresholdMs).toBeGreaterThanOrEqual(12 * 60_000);
    expect(signal.gaps).toEqual([]);
  });

  test("a ship with no AIS at all (Eagle S) is placed from statements over its whole track", () => {
    const track = toReplaySceneInput(EAGLE_S_2024).track;
    const signal = readAisSignal(track);
    expect(signal).toEqual({ kind: "no-ais", reconstructed: { startMs: track[0]?.atMs ?? 0, endMs: track.at(-1)?.atMs ?? 0 } });
  });

  test("an empty track has nothing to show", () => {
    expect(readAisSignal([])).toEqual({ kind: "no-ais", reconstructed: null });
  });

  test("a single report gets a one-hour axis and no gap", () => {
    const signal = readAisSignal([{ atMs: at("2024-11-18T06:01:44Z"), longitude: 0, latitude: 0, recordedSpeedKnots: 7 }]);
    if (signal.kind !== "recorded") throw new Error(`expected recorded AIS, got ${signal.kind}`);
    expect(signal.gaps).toEqual([]);
    expect(signal.axis).toEqual({ startMs: at("2024-11-18T06:00:00Z"), endMs: at("2024-11-18T07:00:00Z") });
  });
});

describe("readAisMoment", () => {
  const signal = readAisSignal(toReplaySceneInput(YI_PENG_3_2024).track);

  test("the C-Lion1 cut at 02:00 sits on the reconstructed stretch", () => {
    expect(readAisMoment(signal, at("2024-11-18T02:00:00Z")).kind).toBe("reconstructed");
  });

  test("07:00 falls in the 50 minute silence", () => {
    const moment = readAisMoment(signal, at("2024-11-18T07:00:00Z"));
    expect(moment.kind === "gap" ? moment.gap.minutes : null).toBe(50);
  });

  test("between two close reports the last one heard is named", () => {
    expect(readAisMoment(signal, at("2024-11-18T07:31:00Z"))).toEqual({ kind: "report", atMs: at("2024-11-18T07:30:04Z") });
  });

  test("before the first position and after the last there is no position", () => {
    expect(readAisMoment(signal, at("2024-11-17T07:46:00Z")).kind).toBe("no-position");
    expect(readAisMoment(signal, at("2024-11-18T11:00:00Z")).kind).toBe("no-position");
  });
});
