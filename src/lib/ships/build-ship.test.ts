import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildShip } from "@/lib/ships/build-ship";
import { SHIP_KINDS, SHIP_SPECS } from "@/lib/ships/ship-specs";

// The hull must measure the ship's real length end to end, or the scale stated under the 3D view is false.
const CASE_LENGTHS_METRES = [132, 169, 190, 224, 228.6];
const SMALL_CRAFT_LENGTHS_METRES = [25, 32];

function measureHull(kind: (typeof SHIP_KINDS)[number], lengthMetres: number) {
  const ship = buildShip({ kind, lengthMetres, tone: "suspect", isDetailed: false });
  const hull = ship.group.children[0];
  if (!(hull instanceof THREE.Mesh)) throw new Error("the first child is the hull");
  const box = new THREE.Box3().setFromBufferAttribute(hull.geometry.getAttribute("position"));
  const wholeShip = new THREE.Box3().setFromObject(ship.group);
  return { ship, box, wholeShip };
}

describe("buildShip", () => {
  test("covers every ship kind", () => {
    expect(SHIP_KINDS).toEqual(["tanker", "bulk-carrier", "general-cargo", "container-ship", "fishing", "tug", "ro-ro", "passenger", "cable-layer"]);
  });

  for (const kind of SHIP_KINDS) {
    const lengths = kind === "fishing" || kind === "tug" ? SMALL_CRAFT_LENGTHS_METRES : CASE_LENGTHS_METRES;
    for (const lengthMetres of lengths) {
      test(`a ${lengthMetres} m ${kind} hull is ${lengthMetres} m long and as wide as its spec`, () => {
        const { box, wholeShip, ship } = measureHull(kind, lengthMetres);
        expect(box.max.x - box.min.x).toBeCloseTo(lengthMetres, 0);
        expect((box.max.z - box.min.z) / lengthMetres).toBeCloseTo(SHIP_SPECS[kind].beamToLength, 2);
        expect(box.min.y).toBeCloseTo(-SHIP_SPECS[kind].draughtToLength * lengthMetres, 1);
        // Nothing the generator places is lost to NaN, and no fitting sticks out past the bow by more than a sheave.
        expect(Number.isFinite(wholeShip.max.y)).toBe(true);
        expect(wholeShip.max.x - box.max.x).toBeLessThan(0.04 * lengthMetres + 3);
        // The hawse pipe is forward of amidships, above the waterline, on the port side.
        expect(ship.hawseLocal.x).toBeGreaterThan(0.3 * lengthMetres);
        expect(ship.hawseLocal.y).toBeGreaterThan(0);
        expect(ship.hawseLocal.z).toBeLessThan(0);
      });
    }
  }
});
