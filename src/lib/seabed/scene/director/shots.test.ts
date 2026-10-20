import { describe, expect, test } from "bun:test";
import { CABLE_CASES, findCableCase } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { buildShotList, pickShotAt, readShotView, type DirectorCaseInput, type ShotKind } from "@/lib/seabed/scene/director/shots";

const minute = (isoMinute: string) => Date.parse(`${isoMinute}:00Z`);

function readEagleS(): DirectorCaseInput {
  const eagleS = findCableCase("eagle-s-2024");
  if (!eagleS) throw new Error("[readEagleS] the Eagle S case is gone");
  return toReplaySceneInput(eagleS);
}

describe("buildShotList", () => {
  test("tells Eagle S in the five storyboard shots (board 21)", () => {
    const shots = buildShotList(readEagleS());
    expect(shots.map((shot) => [shot.kind, new Date(shot.startMs).toISOString().slice(11, 16), new Date(shot.endMs).toISOString().slice(11, 16)])).toEqual([
      ["establishing", "10:00", "10:26"],
      ["follow", "10:26", "16:38"],
      ["approach", "16:38", "16:44"],
      ["cut", "16:44", "16:46"],
      ["aftermath", "16:46", "23:00"],
    ]);
    // The close-up is C-Lion1's (second in case order); Estlink 2 is cut at the first position, inside the establishing shot.
    expect(shots[2]).toMatchObject({ kind: "approach", cutIndex: 1 });
    expect(shots[3]).toMatchObject({ kind: "cut", cutIndex: 1 });
  });

  test("covers every case's window with shots that join end to start", () => {
    for (const cableCase of CABLE_CASES) {
      const input = toReplaySceneInput(cableCase);
      const shots = buildShotList(input);
      expect(shots[0].startMs).toBe(input.windowStartMs);
      expect(shots[shots.length - 1]?.endMs).toBe(input.windowEndMs);
      shots.forEach((shot, index) => {
        // Only the establishing shot may last a single instant (a window that opens on the first position).
        if (index > 0) expect(shot.endMs).toBeGreaterThan(shot.startMs);
        if (index > 0) expect(shot.startMs).toBe(shots[index - 1]?.endMs ?? Number.NaN);
      });
      // The replay opens on the ship's first position (console-state.ts, openingMs), on the establishing view.
      const openingMs = Math.min(input.windowEndMs, Math.max(input.windowStartMs, input.track[0]?.atMs ?? input.windowStartMs));
      expect(pickShotAt(shots, openingMs).kind).toBe("establishing");
    }
  });

  test("follows the ship to the end of the drag, then pulls back, when no cut can be approached", () => {
    const input: DirectorCaseInput = {
      windowStartMs: minute("2024-01-01T00:00"),
      windowEndMs: minute("2024-01-01T06:00"),
      track: [
        { atMs: minute("2024-01-01T01:00"), longitude: 0, latitude: 0, recordedSpeedKnots: null },
        { atMs: minute("2024-01-01T05:00"), longitude: 1, latitude: 0, recordedSpeedKnots: null },
      ],
      dragWindow: { startMs: minute("2024-01-01T01:00"), endMs: minute("2024-01-01T03:00") },
      cuts: [{ cableName: "Cable", label: "Cable", atMs: minute("2024-01-01T01:00"), longitude: 0, latitude: 0 }],
    };
    expect(buildShotList(input).map((shot) => shot.kind)).toEqual<ShotKind[]>(["establishing", "follow", "aftermath"]);
  });

  test("gives a second cut inside the first one's close-up no shots of its own", () => {
    const input: DirectorCaseInput = {
      windowStartMs: minute("2024-01-01T00:00"),
      windowEndMs: minute("2024-01-01T06:00"),
      track: [{ atMs: minute("2024-01-01T00:30"), longitude: 0, latitude: 0, recordedSpeedKnots: null }],
      dragWindow: null,
      cuts: [
        { cableName: "First", label: "First", atMs: minute("2024-01-01T02:00"), longitude: 0, latitude: 0 },
        { cableName: "Second", label: "Second", atMs: minute("2024-01-01T02:01"), longitude: 0, latitude: 0 },
      ],
    };
    expect(buildShotList(input).map((shot) => shot.kind)).toEqual<ShotKind[]>(["establishing", "follow", "approach", "cut", "aftermath"]);
  });

  test("opens on an instant of establishing when the window starts on the first position", () => {
    const atMs = minute("2024-01-01T00:00");
    const shots = buildShotList({ windowStartMs: atMs, windowEndMs: atMs + 60_000, track: [], dragWindow: null, cuts: [{ cableName: "Cable", label: "Cable", atMs, longitude: 0, latitude: 0 }] });
    expect(shots.map((shot) => shot.kind)).toEqual<ShotKind[]>(["establishing", "aftermath"]);
    expect(pickShotAt(shots, atMs).kind).toBe("establishing");
    expect(pickShotAt(shots, atMs + 1).kind).toBe("aftermath");
  });
});

describe("pickShotAt", () => {
  const shots = buildShotList(readEagleS());

  test("picks the storyboard's shot at each of its moments", () => {
    expect(pickShotAt(shots, minute("2024-12-25T10:20")).kind).toBe("establishing");
    expect(pickShotAt(shots, minute("2024-12-25T10:40")).kind).toBe("follow");
    expect(pickShotAt(shots, minute("2024-12-25T16:38")).kind).toBe("approach");
    expect(pickShotAt(shots, minute("2024-12-25T16:44")).kind).toBe("cut");
    expect(pickShotAt(shots, minute("2024-12-25T17:00")).kind).toBe("aftermath");
  });

  test("keeps the establishing shot on the first position, where the replay opens", () => {
    expect(pickShotAt(shots, minute("2024-12-25T10:26")).kind).toBe("establishing");
    expect(pickShotAt(shots, minute("2024-12-25T10:26") + 1).kind).toBe("follow");
  });

  test("takes the nearest shot outside the window", () => {
    expect(pickShotAt(shots, minute("2024-12-25T09:00")).kind).toBe("establishing");
    expect(pickShotAt(shots, minute("2024-12-25T23:00")).kind).toBe("aftermath");
    expect(pickShotAt(shots, minute("2024-12-26T02:00")).kind).toBe("aftermath");
  });
});

describe("readShotView", () => {
  test("draws the cut in the close-up and every other shot on the overview scene", () => {
    const views = buildShotList(readEagleS()).map(readShotView);
    expect(views).toEqual(["overview", "vessel", "vessel", "closeup", "top"]);
  });
});
