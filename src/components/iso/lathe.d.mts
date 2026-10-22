// Types for the parts of lathe.mjs (the Anatomy kit, MIT, see ./LICENSE) that the anchor figure calls, written from
// the kit's own reference (references/kit.md, section 10). The module itself is plain JavaScript.
import type { Flat, Point3, Projection, SolidPaths } from "./iso-kit";

/** A frame: origin, unit axis, and two unit radial directions. */
export interface Frame {
  o: Point3;
  a: Point3;
  u: Point3;
  v: Point3;
}
/** A meridian knot: [s along the axis, r from it], with an optional third 1 that marks it smooth. */
export type Knot = [number, number] | [number, number, number];
export type LatheOptions = { steps?: number; fill?: "auto" | "hull" | "surface" | "facets"; hole?: [number, number] | null; bevel?: number; rims?: "all" | "none" | "first" | "last" | "ends"; smooth?: boolean | "auto" };

export function dot3(a: Point3, b: Point3): number;
export function add3(a: Point3, b: Point3): Point3;
export function sub3(a: Point3, b: Point3): Point3;
export function mul3(a: Point3, k: number): Point3;
export function len3(a: Point3): number;
export function unit3(a: Point3): Point3;
export function cross3(a: Point3, b: Point3): Point3;
export function viewOf(P: Projection): Point3;
export function lightOf(P: Projection): Point3;
export function scaleOf(P: Projection): number;
export function frameAlong(o: Point3, a: Point3): Frame;
export function frameOf(o: Point3, a: Point3, u: Point3, v: Point3): Frame;
export function pointOf(F: Frame, s: number, r: number, angle: number): Point3;
export function hullOf(points: Flat[]): Flat[];
export function lathe(meridian: Knot[], F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function solidOf(profile: Knot[], F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function disc(s0: number, s1: number, r: number, F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function ringBand(s0: number, s1: number, rIn: number, rOut: number, F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function prismOf(F: Frame, polygon: Flat[], s0: number, s1: number, P: Projection): SolidPaths;
export function sphereOf(centre: Point3, r: number, P: Projection, options?: { steps?: number }): SolidPaths;
export function arcOf(F: Frame, s: number, r: number, P: Projection, options?: { slope?: number; steps?: number; least?: number; inward?: boolean; from?: number; to?: number; trim?: number }): string;
export function circleOf(F: Frame, s: number, r: number, P: Projection, steps?: number): string;
export function ribsOf(F: Frame, s0: number, s1: number, r: number, count: number, P: Projection, options?: { phase?: number; twist?: number; least?: number; r1?: number; seams?: boolean }): string;
export function dotsOf(F: Frame, s: number, r: number, count: number, P: Projection, options?: { phase?: number; slope?: number; least?: number; all?: boolean }): Flat[];
export function fillet(points: Point3[], radius: number, perArc?: number, options?: { P?: Projection | null; tube?: number; margin?: number }): Point3[];
export function pathLength(points: Point3[]): number;
