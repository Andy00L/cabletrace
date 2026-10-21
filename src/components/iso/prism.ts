// From the Anatomy kit (github.com/wheresryan22/anatomy, kit/lathe.mjs), MIT licence: see ./LICENSE. The vector helpers,
// the camera's view and light, and `prismOf` (a prism of any polygon along any axis), ported from JavaScript to typed
// TypeScript with the same maths; the rest of the lathe module is left out.
import { cameraOf, iso, pathOf, type Flat, type Point3, type Projection, type SolidPaths } from "./iso-kit";

const LIGHT_UP = 1.2;
const BANDS = [0, 0.2, 0.42, 0.62];

export const dot3 = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add3 = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a: Point3, k: number): Point3 => [a[0] * k, a[1] * k, a[2] * k];
export const len3 = (a: Point3) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: Point3): Point3 => {
  const length = len3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
export const cross3 = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function viewOf(P: Projection): Point3 {
  const { sinA, cosA, sinE, cosE } = cameraOf(P);
  return [cosA * cosE, sinA * cosE, sinE];
}

export function lightOf(P: Projection): Point3 {
  const { sinA, cosA } = cameraOf(P);
  return unit3([-sinA, cosA, LIGHT_UP]);
}

export function bandOf(score: number) {
  let tone = 0;
  while (tone < BANDS.length && score >= (BANDS[tone] ?? Infinity)) tone++;
  return tone;
}

/** A frame: origin, unit axis, and two unit radial directions. */
export interface Frame {
  o: Point3;
  a: Point3;
  u: Point3;
  v: Point3;
}

export const frameOf = (o: Point3, a: Point3, u: Point3, v: Point3): Frame => ({ o, a, u, v });

export function hullOf(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 1e-9) lower.pop();
    lower.push(point);
  }
  const upper: Flat[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 1e-9) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const signedArea = (points: Flat[]) =>
  points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length]!;
    return sum + x * ny - nx * y;
  }, 0) / 2;

const oriented = (points: Flat[]) => (signedArea(points) < 0 ? [...points].reverse() : points);

/** A prism of a convex polygon in the frame's u, v plane, extruded along F.a from s0 to s1, shaded by facing. */
export function prismOf(F: Frame, polygon: Flat[], s0: number, s1: number, P: Projection): SolidPaths {
  const V = viewOf(P);
  const L = lightOf(P);
  const ring = oriented(polygon.map(([x, y]): Flat => [x, y]));
  const n = ring.length;
  const at = (s: number, [x, y]: Flat): Point3 => [
    F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y,
    F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y,
    F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y,
  ];
  const low = ring.map((point) => iso(at(s0, point), P));
  const high = ring.map((point) => iso(at(s1, point), P));
  const buckets: string[][] = [[], [], [], [], []];
  const seen: boolean[] = [];
  for (let j = 0; j < n; j++) {
    const [x0, y0] = ring[j]!;
    const [x1, y1] = ring[(j + 1) % n]!;
    const normal = unit3(add3(mul3(F.u, y1 - y0), mul3(F.v, -(x1 - x0))));
    const visible = dot3(normal, V) > 1e-6;
    seen.push(visible);
    if (visible) buckets[bandOf(dot3(normal, L))]!.push(pathOf([low[j]!, low[(j + 1) % n]!, high[(j + 1) % n]!, high[j]!], true));
  }
  const ends: [Flat[], Point3][] = [
    [low, mul3(F.a, -1)],
    [high, F.a],
  ];
  const capSeen = ends.map(([, normal]) => dot3(normal, V) > 1e-6);
  ends.forEach(([points, normal], index) => {
    if (capSeen[index]) buckets[bandOf(dot3(normal, L))]!.push(pathOf(points, true));
  });
  const hull = hullOf([...low, ...high]);
  const creases: string[] = [];
  for (let j = 0; j < n; j++) {
    const prev = (j - 1 + n) % n;
    const a: Flat = [ring[j]![0] - ring[prev]![0], ring[j]![1] - ring[prev]![1]];
    const b: Flat = [ring[(j + 1) % n]![0] - ring[j]![0], ring[(j + 1) % n]![1] - ring[j]![1]];
    const sharp = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1) < Math.cos(0.35);
    if (sharp && seen[j] && seen[prev]) creases.push(pathOf([low[j]!, high[j]!]));
    ends.forEach(([points], index) => {
      if (capSeen[index] && seen[j]) creases.push(pathOf([points[j]!, points[(j + 1) % n]!]));
    });
  }
  return { fill: pathOf(hull, true), outline: pathOf(hull, true), crease: creases.join(""), top: buckets[4]!.join(""), shades: buckets.slice(0, 4).map((list) => list.join("")) };
}
