import { describe, expect, test } from "bun:test";
import { chooseFollowBearing, easeFollowBearing, placeFollowOffset, PREFERRED_BEARING, type FollowBearing, type FollowSightInput } from "@/lib/seabed/scene/follow-sight";

// A ship at the origin heading east (+x), drawn 0.48 km long (Hai Hong Gong 66), with the viewer's offsets and tuning
// in ship lengths. Its usual camera stands behind it to starboard: west and south (+z is south in the scene).
const DRAWN_LENGTH_KM = 0.48;
const SEA_FLOOR_KM = -0.2;
const BASE_INPUT: Omit<FollowSightInput, "sampleTerrainY"> = {
  shipPosition: { x: 0, y: 0, z: 0 },
  deckHeightKm: 0.036 * DRAWN_LENGTH_KM,
  heading: { x: 1, z: 0 },
  offset: { behindKm: 1.06 * DRAWN_LENGTH_KM, sideKm: 1.13 * DRAWN_LENGTH_KM, aboveKm: 0.45 * DRAWN_LENGTH_KM },
  heldBearing: PREFERRED_BEARING,
  tuning: {
    clearanceKm: 0.1 * DRAWN_LENGTH_KM,
    hysteresisKm: 0.1 * DRAWN_LENGTH_KM,
    azimuthStepRadians: Math.PI / 12,
    liftStepKm: 0.25 * DRAWN_LENGTH_KM,
    maxLiftSteps: 4,
    sampleCount: 32,
    nearDeckSkipKm: 0.6 * DRAWN_LENGTH_KM,
  },
};

/** A heightfield: open water, with a wall `heightKm` tall wherever `isLand` holds. */
function createHeightfield(isLand: (sceneX: number, sceneZ: number) => boolean, heightKm: number) {
  return (sceneX: number, sceneZ: number) => (isLand(sceneX, sceneZ) ? heightKm : SEA_FLOOR_KM);
}

function placeCamera(bearing: FollowBearing) {
  return placeFollowOffset(BASE_INPUT.heading, BASE_INPUT.offset, bearing);
}

describe("placeFollowOffset", () => {
  test("puts the usual camera behind the ship and to starboard, exactly as the offset says", () => {
    const placed = placeCamera(PREFERRED_BEARING);
    expect(placed).toEqual({ x: -BASE_INPUT.offset.behindKm, y: BASE_INPUT.offset.aboveKm, z: BASE_INPUT.offset.sideKm });
  });

  test("turns the offset about the vertical through the ship and raises it by the lift", () => {
    const placed = placeCamera({ azimuthRadians: Math.PI, liftKm: 0.1 });
    expect(placed.x).toBeCloseTo(BASE_INPUT.offset.behindKm, 9);
    expect(placed.z).toBeCloseTo(-BASE_INPUT.offset.sideKm, 9);
    expect(placed.y).toBeCloseTo(BASE_INPUT.offset.aboveKm + 0.1, 9);
  });
});

describe("chooseFollowBearing", () => {
  test("keeps the usual spot over open water", () => {
    const choice = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY: createHeightfield(() => false, 0) });
    expect(choice).toEqual({ kind: "clear", bearing: PREFERRED_BEARING, clearanceKm: expect.any(Number) });
  });

  test("swings to the open side, by the smallest clear turn, when a wall stands on the camera's side", () => {
    // Land south of the ship from 0.3 km out, 0.6 km tall (an island beside a moored ship).
    const sampleTerrainY = createHeightfield((_sceneX, sceneZ) => sceneZ > 0.3, 0.6);
    const choice = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY });
    if (choice.kind !== "clear") throw new Error(`expected a clear bearing, got ${choice.kind}`);
    expect(choice.bearing.liftKm).toBe(0);
    expect(placeCamera(choice.bearing).z).toBeLessThanOrEqual(0.3);
    // One step less of turn, either way, is still blocked: this is the nearest clear bearing.
    const smallerTurn = Math.abs(choice.bearing.azimuthRadians) - BASE_INPUT.tuning.azimuthStepRadians;
    for (const azimuthRadians of [smallerTurn, -smallerTurn]) {
      const blocked = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY, heldBearing: { azimuthRadians, liftKm: 0 } });
      expect(blocked.kind === "clear" && blocked.bearing.azimuthRadians === azimuthRadians).toBe(false);
    }
  });

  test("finds the gap between walls on both sides", () => {
    // A channel along the ship's heading: land 0.6 km tall on both sides from 0.25 km out.
    const choice = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY: createHeightfield((_sceneX, sceneZ) => Math.abs(sceneZ) > 0.25, 0.6) });
    if (choice.kind !== "clear") throw new Error(`expected a clear bearing, got ${choice.kind}`);
    expect(choice.bearing.liftKm).toBe(0);
    expect(Math.abs(placeCamera(choice.bearing).z)).toBeLessThanOrEqual(0.25);
  });

  test("raises the camera when land rings the ship lower than a raise can clear", () => {
    // A ring of hills 0.25 km tall from 0.45 km out, all round: no turn at the usual height clears it.
    const sampleTerrainY = createHeightfield((sceneX, sceneZ) => Math.hypot(sceneX, sceneZ) > 0.45, 0.25);
    const choice = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY });
    if (choice.kind !== "clear") throw new Error(`expected a clear bearing, got ${choice.kind}`);
    expect(choice.bearing.liftKm).toBeGreaterThan(0);
    expect(choice.bearing.azimuthRadians).toBe(0);
  });

  test("gives up when nothing is clear even raised", () => {
    const choice = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY: createHeightfield((sceneX, sceneZ) => Math.hypot(sceneX, sceneZ) > 0.3, 5) });
    expect(choice).toEqual({ kind: "blocked" });
  });

  test("holds a swung bearing until the usual spot clears by the hysteresis margin", () => {
    const swung: FollowBearing = { azimuthRadians: Math.PI / 2, liftKm: 0 };
    // Ground 20 m under the sight lines' lowest point all round: every bearing clears it, by more than the clearance
    // but less than clearance plus hysteresis, so nothing nearer the usual spot can take the camera back.
    const lowGround = () => 0.02;
    const usual = chooseFollowBearing({ ...BASE_INPUT, sampleTerrainY: lowGround });
    if (usual.kind !== "clear") throw new Error("the usual spot should clear the low ground");
    expect(usual.bearing).toBe(PREFERRED_BEARING);
    expect(usual.clearanceKm).toBeGreaterThan(BASE_INPUT.tuning.clearanceKm);
    expect(usual.clearanceKm).toBeLessThan(BASE_INPUT.tuning.clearanceKm + BASE_INPUT.tuning.hysteresisKm);
    const held = chooseFollowBearing({ ...BASE_INPUT, heldBearing: swung, sampleTerrainY: lowGround });
    expect(held.kind === "clear" && held.bearing).toBe(swung);
    // Over open water the usual spot clears by far more: the camera goes back.
    const back = chooseFollowBearing({ ...BASE_INPUT, heldBearing: swung, sampleTerrainY: createHeightfield(() => false, 0) });
    expect(back.kind === "clear" && back.bearing.azimuthRadians).toBe(0);
  });
});

describe("easeFollowBearing", () => {
  test("turns the short way round and settles on the target itself", () => {
    const target: FollowBearing = { azimuthRadians: -Math.PI * 0.9, liftKm: 0 };
    const halfway = easeFollowBearing({ azimuthRadians: Math.PI * 0.9, liftKm: 0 }, target, 0.5);
    // From +0.9 pi to -0.9 pi the short way crosses pi: halfway is at pi, not at 0.
    expect(Math.abs(halfway.azimuthRadians)).toBeCloseTo(Math.PI, 9);
    expect(easeFollowBearing(halfway, target, 1)).toBe(target);
  });
});
