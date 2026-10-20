import type { ShotKind } from "@/lib/seabed/scene/director/shots";
import type { CameraPose } from "@/lib/seabed/scene/director/viewer-port";

// How the director gets from one shot to the next: a flight on the motion tokens, or a cut. It cuts only into and out
// of the close-up (another scene, joined by the viewer's crossfade) and under reduced motion; everything else flies.

/** `duration-hero`, the replay's hero moment, on `ease-standard` (docs/UI_DESIGN_SYSTEM.md, Motion). */
export const SHOT_FLIGHT_MS = 480;

export type ShotTransition = { kind: "cut" } | { kind: "flight"; durationMs: number };

/**
 * The move into a shot of kind `next` from what held the camera before: a shot, the user (the director resumes from
 * wherever they left the camera), or nothing (the director's first frame, which starts on its shot).
 */
export function planShotTransition(previous: ShotKind | "user" | null, next: ShotKind, prefersReducedMotion: boolean): ShotTransition {
  if (prefersReducedMotion || previous === null || previous === "cut" || next === "cut") return { kind: "cut" };
  return { kind: "flight", durationMs: SHOT_FLIGHT_MS };
}

// ease-standard is cubic-bezier(0.4, 0, 0.2, 1) (src/app/globals.css, --ease-standard).
const EASE_STANDARD = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const;
const BEZIER_SOLVE_STEPS = 24;

function sampleBezier(share: number, first: number, second: number): number {
  return 3 * (1 - share) ** 2 * share * first + 3 * (1 - share) * share ** 2 * second + share ** 3;
}

/** ease-standard at `amount` (0 to 1): the curve solved for its x by bisection, then read for its y. */
export function easeStandard(amount: number): number {
  if (amount <= 0) return 0;
  if (amount >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < BEZIER_SOLVE_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (sampleBezier(middle, EASE_STANDARD.x1, EASE_STANDARD.x2) < amount) low = middle;
    else high = middle;
  }
  return sampleBezier((low + high) / 2, EASE_STANDARD.y1, EASE_STANDARD.y2);
}

/** The pose `amount` (0 to 1, already eased) of the way from `from` to `to`; position, target and field of view move together. */
export function interpolatePose(from: CameraPose, to: CameraPose, amount: number): CameraPose {
  return {
    position: from.position.clone().lerp(to.position, amount),
    target: from.target.clone().lerp(to.target, amount),
    fovDegrees: from.fovDegrees + (to.fovDegrees - from.fovDegrees) * amount,
  };
}
