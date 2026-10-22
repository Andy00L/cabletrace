// The landing time-lapse's camera: one slow continuous move from a wide pose (the console's own overview camera, or a
// pose that frames the whole drag from Estlink 2 to C-Lion1) to a closer pose on the last cut, framed with the
// director's own math (fitCameraToPoints, framing.ts) from the subjects the viewer reports. Between the two keys the
// camera's target, its distance (geometrically, so the push-in reads even), its compass angle and its elevation move
// together along eases that start and end at rest, so the held end shows no last-frame step.
import * as THREE from "three";
import type { Result } from "../../src/lib/result";
import { azimuthOf, directionFrom, fitCameraToPoints } from "../../src/lib/seabed/scene/director/framing";
import type { CameraPose, CanvasSize, SafeArea } from "../../src/lib/seabed/scene/director/viewer-port";
import type { NamedSubject } from "./console-page";

/**
 * A key of the move. `overview`: the console's overview camera as it opens at this canvas size. `framed`: the camera
 * that fits the named subjects from a compass azimuth and an elevation (degrees), pulled back `pullBack` times the
 * distance at which they just fit, so they sit centred with their surroundings.
 */
export type CameraKey =
  | { kind: "overview" }
  | { kind: "framed"; subjectNames: readonly string[]; azimuthDegrees: number; elevationDegrees: number; fovDegrees: number; pullBack: number };

/** The move for one crop: the two keys, and the share of the move the push-in waits before it starts (0 to 1). */
export type CameraMove = { start: CameraKey; end: CameraKey; pushDelayShare: number };

// The share of the push-in over which the camera's aim moves onto the followed ship; the distance closes over all of it.
const TARGET_LEAD_SHARE = 0.6;

function findSubject(subjects: readonly NamedSubject[], name: string): THREE.Vector3 | null {
  const found = subjects.find((subject) => subject.name === name);
  return found ? new THREE.Vector3(...found.scene) : null;
}

/** smootherstep: 0 to 1 with zero speed and acceleration at both ends. */
function easeAtRest(amount: number): number {
  const clamped = Math.min(1, Math.max(0, amount));
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

/** A key as the move interpolates it: where the camera looks, from how far, from which angle, through which lens. */
type OrbitPose = { target: THREE.Vector3; distanceKm: number; azimuthDegrees: number; elevationDegrees: number; fovDegrees: number };

function toOrbitPose(pose: CameraPose): OrbitPose {
  const offset = pose.position.clone().sub(pose.target);
  const distanceKm = offset.length();
  return { target: pose.target.clone(), distanceKm, azimuthDegrees: azimuthOf(offset), elevationDegrees: THREE.MathUtils.radToDeg(Math.asin(offset.y / distanceKm)), fovDegrees: pose.fovDegrees };
}

function resolveKey(input: { key: CameraKey; subjects: readonly NamedSubject[]; overviewPose: CameraPose; canvas: CanvasSize; safeArea: SafeArea }): Result<OrbitPose> {
  const { key, subjects, overviewPose, canvas, safeArea } = input;
  if (key.kind === "overview") return { ok: true, value: toOrbitPose(overviewPose) };
  const points: THREE.Vector3[] = [];
  for (const name of key.subjectNames) {
    const point = findSubject(subjects, name);
    if (!point) return { ok: false, reason: `the viewer reported no subject "${name}"` };
    points.push(point);
  }
  const pose = fitCameraToPoints({ points, direction: directionFrom(key.azimuthDegrees, key.elevationDegrees), fovDegrees: key.fovDegrees, canvas, safeArea });
  if (!pose) return { ok: false, reason: "the framing found no pose (no points or no canvas)" };
  const distanceKm = pose.position.distanceTo(pose.target) * key.pullBack;
  return { ok: true, value: { target: pose.target, distanceKm, azimuthDegrees: key.azimuthDegrees, elevationDegrees: key.elevationDegrees, fovDegrees: key.fovDegrees } };
}

/**
 * Plans the move and returns the pose at any share of it (0 the first frame, 1 the last of the time-lapse and the
 * held end). The orbit runs over the whole move; the push-in waits `pushDelayShare` of it, so the whole drag stays in
 * frame while the ship crosses the gulf. While it pushes in, the end key's target travels with `readFocus` (the ship),
 * arriving where the end key framed it at share 1, so a camera that closes in never leaves the ship behind.
 */
export function planCameraMove(input: {
  move: CameraMove;
  subjects: readonly NamedSubject[];
  overviewPose: CameraPose;
  canvas: CanvasSize;
  safeArea: SafeArea;
  readFocus: (share: number) => THREE.Vector3;
}): Result<(share: number) => CameraPose> {
  const start = resolveKey({ ...input, key: input.move.start });
  if (!start.ok) return start;
  const end = resolveKey({ ...input, key: input.move.end });
  if (!end.ok) return end;
  const from = start.value;
  const to = end.value;
  const { pushDelayShare } = input.move;
  const endFocus = input.readFocus(1);
  return {
    ok: true,
    value: (share) => {
      const orbit = easeAtRest(share);
      const push = easeAtRest((share - pushDelayShare) / (1 - pushDelayShare));
      // The aim reaches the followed ship in the first TARGET_LEAD_SHARE of the push, before the camera is close.
      const aim = easeAtRest((share - pushDelayShare) / ((1 - pushDelayShare) * TARGET_LEAD_SHARE));
      const followedTarget = to.target.clone().add(input.readFocus(share)).sub(endFocus);
      const target = from.target.clone().lerp(followedTarget, aim);
      const distanceKm = from.distanceKm * Math.pow(to.distanceKm / from.distanceKm, push);
      const azimuthDegrees = from.azimuthDegrees + (to.azimuthDegrees - from.azimuthDegrees) * orbit;
      const elevationDegrees = from.elevationDegrees + (to.elevationDegrees - from.elevationDegrees) * orbit;
      const fovDegrees = from.fovDegrees + (to.fovDegrees - from.fovDegrees) * push;
      const position = target.clone().addScaledVector(directionFrom(azimuthDegrees, elevationDegrees), distanceKm);
      return { position, target, fovDegrees };
    },
  };
}
