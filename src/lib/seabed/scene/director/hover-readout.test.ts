import { describe, expect, test } from "bun:test";
import { findNearestCable, findNearestPass, sampleTrack } from "@/lib/seabed/scene/director/hover-readout";

// One degree of longitude is drawn as 10 km here, one of latitude as 10 km too.
const toScene = (longitude: number, latitude: number) => ({ x: longitude * 10, z: -latitude * 10 });
const at = (clock: string) => Date.parse(`2024-12-25T${clock}:00Z`);

describe("sampleTrack and findNearestPass", () => {
  const track = [
    { atMs: at("10:00"), longitude: 0, latitude: 0, recordedSpeedKnots: null },
    { atMs: at("10:10"), longitude: 1, latitude: 0, recordedSpeedKnots: null },
  ];

  test("samples the track every minute from its first position to its last", () => {
    const samples = sampleTrack(track, toScene);
    expect(samples.length).toBe(11);
    expect(samples[10]).toEqual({ atMs: at("10:10"), point: { x: 10, z: -0 } });
  });

  test("names the moment the ship passed nearest a point, and how far it was", () => {
    // 2 km north of the track, above the point the ship reached at 10:04.
    const pass = findNearestPass(sampleTrack(track, toScene), { x: 4, z: -2 });
    expect(pass?.atMs).toBe(at("10:04"));
    expect(pass?.distanceMetres).toBeCloseTo(2000, 6);
    expect(findNearestPass([], { x: 0, z: 0 })).toBeNull();
  });
});

describe("findNearestCable", () => {
  test("measures to the nearest point of the nearest cable", () => {
    const runs = [
      { name: "Far", points: [{ x: 0, z: 10 }, { x: 10, z: 10 }] },
      { name: "Near", points: [{ x: 0, z: 1 }, { x: 10, z: 1 }] },
    ];
    expect(findNearestCable(runs, { x: 5, z: 0 })).toEqual({ name: "Near", distanceMetres: 1000 });
    expect(findNearestCable([], { x: 5, z: 0 })).toBeNull();
  });
});
