import { cylinder, depthOf, extrude, lineSvg, roundedPlan, slabOf, solidSvg, type Flat, type Plan, type Plane, type Point3, type Projection, type SolidPaths, type SolidStyle } from "@/components/iso/iso-kit";
import { disc, prismOf, solidOf, sphereOf, type Frame, type Knot } from "@/components/iso/lathe.mjs";
import { tubePieces, tubeSvg, type TubeRings } from "@/components/iso/tube.mjs";

// The anchor figure's parts: each one drawn with the Anatomy kit and described by its true shape, so the same build
// paints the figure (sorted far to near) and, in the audit script, records every shape for the kit's audit
// (kit/audit.mjs: clearances, supports, depth order). A shape here is plain data the audit script turns into its own.

export type PartShape =
  | { kind: "extruded"; ring: Plane[]; z: number; height: number }
  | { kind: "prism"; frame: Frame; polygon: Flat[]; s0: number; s1: number }
  | { kind: "solid"; frame: Frame; profile: Knot[] }
  | { kind: "ball"; at: Point3; r: number }
  | { kind: "tube"; points: Point3[]; r: number };

export type Part = {
  /** A name for the audit report, with the assembly first: `ship.windlass.port`. */
  name: string;
  svg: string;
  /** The point whose depth orders the part, and a bias that settles ties between touching parts. */
  at: Point3;
  bias: number;
  shapes: PartShape[];
};

/** Paints parts far to near (the kit's depthOf, plus each part's bias), as one string. */
export function paintParts(parts: readonly Part[], projection: Projection): string {
  return [...parts]
    .map((part) => ({ part, key: depthOf(part.at, projection) + part.bias }))
    .sort((first, second) => first.key - second.key)
    .map((entry) => entry.part.svg)
    .join("");
}

type Look = SolidStyle & { bias?: number };

const centreOfRing = (ring: Plane[], z: number, height: number): Point3 => {
  const sum = ring.reduce<Plane>((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length, z + height / 2];
};

/** A rounded box standing on the floor plan. */
export function slabPart(name: string, plan: Plan, z: number, height: number, projection: Projection, look: Look & { steps?: number; bevel?: number } = {}): Part {
  const steps = look.steps ?? 3;
  const ring = roundedPlan(plan, steps);
  return {
    name,
    svg: solidSvg(slabOf(plan, z, height, projection, steps, look.bevel ?? 0), look),
    at: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2],
    bias: look.bias ?? 0,
    shapes: [{ kind: "extruded", ring, z, height }],
  };
}

/** Any floor outline extruded up (convex outlines only: the kit fills the hull). */
export function extrudedPart(name: string, ring: Plane[], z: number, height: number, projection: Projection, look: Look = {}): Part {
  return { name, svg: solidSvg(extrude(ring, z, height, projection), look), at: centreOfRing(ring, z, height), bias: look.bias ?? 0, shapes: [{ kind: "extruded", ring, z, height }] };
}

/** A round post, foot or puck standing on the floor. */
export function postPart(name: string, centre: Plane, radius: number, z: number, height: number, projection: Projection, look: Look & { steps?: number } = {}): Part {
  const steps = look.steps ?? 16;
  const ring: Plane[] = Array.from({ length: steps }, (_slot, index) => [centre[0] + radius * Math.cos((index / steps) * Math.PI * 2), centre[1] + radius * Math.sin((index / steps) * Math.PI * 2)]);
  return { name, svg: solidSvg(cylinder(centre[0], centre[1], radius, z, height, projection, steps), look), at: [centre[0], centre[1], z + height / 2], bias: look.bias ?? 0, shapes: [{ kind: "extruded", ring, z, height }] };
}

/** A prism of a convex polygon in a frame's u, v plane, along its axis from s0 to s1. */
export function prismPart(name: string, frame: Frame, polygon: Flat[], s0: number, s1: number, projection: Projection, look: Look & { inner?: string } = {}): Part {
  const middle = (s0 + s1) / 2;
  const sum = polygon.reduce<Flat>((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
  const [centreU, centreV] = [sum[0] / polygon.length, sum[1] / polygon.length];
  const at: Point3 = [
    frame.o[0] + frame.a[0] * middle + frame.u[0] * centreU + frame.v[0] * centreV,
    frame.o[1] + frame.a[1] * middle + frame.u[1] * centreU + frame.v[1] * centreV,
    frame.o[2] + frame.a[2] * middle + frame.u[2] * centreU + frame.v[2] * centreV,
  ];
  return { name, svg: solidSvg(prismOf(frame, polygon, s0, s1, projection), look), at, bias: look.bias ?? 0, shapes: [{ kind: "prism", frame, polygon, s0, s1 }] };
}

/** A turned part: a profile of [s, r] knots closed to the axis at both ends. */
export function turnedPart(name: string, frame: Frame, profile: Knot[], projection: Projection, look: Look & { inner?: string } = {}): Part {
  const middle = profile.reduce((total, knot) => total + knot[0], 0) / profile.length;
  const at: Point3 = [frame.o[0] + frame.a[0] * middle, frame.o[1] + frame.a[1] * middle, frame.o[2] + frame.a[2] * middle];
  return { name, svg: solidSvg(solidOf(profile, frame, projection), look), at, bias: look.bias ?? 0, shapes: [{ kind: "solid", frame, profile }] };
}

/** A short cylinder on a frame's axis: a pin, a flange, a boss. */
export function discPart(name: string, frame: Frame, s0: number, s1: number, radius: number, projection: Projection, look: Look & { inner?: string } = {}): Part {
  const middle = (s0 + s1) / 2;
  const at: Point3 = [frame.o[0] + frame.a[0] * middle, frame.o[1] + frame.a[1] * middle, frame.o[2] + frame.a[2] * middle];
  const profile: Knot[] = [[s0, 0], [s0, radius], [s1, radius], [s1, 0]];
  return { name, svg: solidSvg(disc(s0, s1, radius, frame, projection), look), at, bias: look.bias ?? 0, shapes: [{ kind: "solid", frame, profile }] };
}

/** A ball: a stone, a clod, a fitting. */
export function ballPart(name: string, at: Point3, radius: number, projection: Projection, look: Look = {}): Part {
  return { name, svg: solidSvg(sphereOf(at, radius, projection), look), at, bias: look.bias ?? 0, shapes: [{ kind: "ball", at, r: radius }] };
}

/** A pipe or cable as depth-sorted chunks (the kit's tubePieces), each its own part, so it can pass in front of one part and behind the next. */
/** `breaks` are lengths along the route where a chunk must end (short chunks where the tube passes close to other parts). */
export function tubeParts(name: string, route: Point3[], radius: number, projection: Projection, look: { tone?: "hi" | "mid" | "lo"; rings?: TubeRings; maxLength?: number; breaks?: number[]; caps?: boolean | [boolean, boolean]; bias?: number } = {}): Part[] {
  const pieces = tubePieces(route, radius, projection, { maxLength: look.maxLength ?? 14, breaks: look.breaks ?? [], rings: look.rings ?? null, caps: look.caps ?? true });
  return pieces.map((piece, index) => ({
    name: `${name}~${index}`,
    svg: tubeSvg(piece, { tone: look.tone ?? "hi" }),
    at: piece.mid,
    bias: look.bias ?? 0,
    shapes: [{ kind: "tube", points: piece.points, r: radius }],
  }));
}

/** Line work that belongs to no solid of its own (rules, rails, ticks): painted at a point, with no shape for the audit. */
export function linePart(name: string, d: string, at: Point3, look: { tone?: "hi" | "mid" | "lo" | "faint" | "lit"; className?: string; bias?: number; free?: boolean } = {}): Part {
  return { name, svg: lineSvg(d, { tone: look.tone ?? "lo", className: look.className, free: look.free }), at, bias: look.bias ?? 0, shapes: [] };
}

/** Raw markup painted at a point (a clip, a gradient fill), with no shape for the audit. */
export function markupPart(name: string, svg: string, at: Point3, bias = 0): Part {
  return { name, svg, at, bias, shapes: [] };
}

export type { SolidPaths };
