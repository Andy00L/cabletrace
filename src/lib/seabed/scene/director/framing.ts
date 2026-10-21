import * as THREE from "three";
import type { Shot } from "@/lib/seabed/scene/director/shots";
import type { AnchorSubject, CameraPose, CanvasSize, DirectorSubjects, SafeArea, VesselSubject } from "@/lib/seabed/scene/director/viewer-port";

// Framing math for the director (method of the round-2 storyboard, `fitCamera` in scripts/lookdev/board-round2.ts on
// branch explore/natural-look): a shot names its subjects and the angles it may look from; for each angle the camera
// backs off until every subject fits the safe area with a margin (bisection on the distance), then slides sideways
// until their box sits in the middle of it. Of the angles, the one whose subjects the relief hides least wins.

/** Subjects stay this far inside the safe area (CSS px, board 21). */
export const FRAMING_MARGIN_PX = 24;
// The bisection's bounds on the camera's distance from its target (scene km): a hull close-up to the widest seabed block.
const MIN_DISTANCE_KM = 0.01;
const MAX_DISTANCE_KM = 5000;
const DISTANCE_STEPS = 60;
// Each slide re-centres the box, which changes the distance that fits: a few rounds settle both (board 21 used 6).
const FIT_ROUNDS = 6;
// Near and far planes of the framing camera (scene km); only used to project, never drawn.
const FIT_NEAR_KM = 0.001;
const FIT_FAR_KM = 100_000;

// The storyboard's angles (board 21): elevation above the horizon in degrees, azimuths in compass degrees (0 north,
// 90 east), the first of each list preferred. The follow and approach angles turn with the ship.
const ESTABLISHING = { elevationDegrees: 40, azimuths: [225, 180, 270, 135, 315] } as const;
const AFTERMATH = { elevationDegrees: 75, azimuths: [180, 0, 90, 270] } as const;
/** Relative to the ship's heading: 225 is off the port quarter, looking forward along the hull and down to the anchor. */
const FOLLOW = { elevationDegrees: 38, relativeAzimuths: [225, 135, 270, 90] } as const;
/** Relative to the drag's direction: abeam, low over the seabed, the anchor closing on the cable. */
const APPROACH = { elevationDegrees: 12, relativeAzimuths: [-90, 90, -60, 60] } as const;
// The establishing and aftermath shots frame at least this much of the block (scene km): the drawn scales put a ship
// over a kilometre long, so a story shorter than a few of them is shown with its surroundings.
const MIN_STORY_SPAN_KM = 6;
// The superstructure's top above the waterline, in drawn ship lengths (board 21: 0.25 km on Eagle S's 1.37 km hull).
const SHIP_TOP_LENGTHS = 0.18;

// The anchor cam (board 22): behind the anchor along the drag, a little above it, aimed just past it, wide. In scene
// km, set against the anchor drawn 30 times its size (about 0.1 km long, src/lib/seabed/scene-scales.ts).
const ANCHOR_CAM_BEHIND_KM = 0.45;
const ANCHOR_CAM_ABOVE_KM = 0.16;
const ANCHOR_CAM_AIM_AHEAD_KM = 0.12;
const ANCHOR_CAM_FOV_DEGREES = 50;
// The bridge view: from the bridge front, aft of amidships on the hulls the generator builds (src/lib/ships/), at the
// wheelhouse's height, looking ahead and down to the water a few ship lengths off the bow. In drawn ship lengths.
const BRIDGE_AFT_LENGTHS = 0.36;
const BRIDGE_ABOVE_LENGTHS = 0.13;
const BRIDGE_LOOK_AHEAD_LENGTHS = 3;
const BRIDGE_FOV_DEGREES = 55;

/** A unit vector from a target toward a camera: compass azimuth and elevation in degrees. Scene x runs east, z south. */
export function directionFrom(azimuthDegrees: number, elevationDegrees: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

/** Compass azimuth (degrees, 0 to 360) of a direction's horizontal part. */
export function azimuthOf(direction: THREE.Vector3): number {
  return (THREE.MathUtils.radToDeg(Math.atan2(direction.x, -direction.z)) + 360) % 360;
}

/** The safe area shrunk by the framing margin, never inverted on a small canvas. */
function insetByMargin(safeArea: SafeArea): SafeArea {
  const marginX = Math.min(FRAMING_MARGIN_PX, Math.max(0, (safeArea.right - safeArea.left) / 4));
  const marginY = Math.min(FRAMING_MARGIN_PX, Math.max(0, (safeArea.bottom - safeArea.top) / 4));
  return { left: safeArea.left + marginX, top: safeArea.top + marginY, right: safeArea.right - marginX, bottom: safeArea.bottom - marginY };
}

type ProjectedBox = { isAllInFront: boolean; left: number; right: number; top: number; bottom: number };

/**
 * The camera that looks from `direction` and fits every point inside the safe area with the framing margin; null when
 * there is no point to frame or the canvas has no size.
 */
export function fitCameraToPoints(input: { points: readonly THREE.Vector3[]; direction: THREE.Vector3; fovDegrees: number; canvas: CanvasSize; safeArea: SafeArea }): CameraPose | null {
  const { points, fovDegrees, canvas } = input;
  if (points.length === 0 || canvas.widthPx <= 0 || canvas.heightPx <= 0) return null;
  const direction = input.direction.clone().normalize();
  const safe = insetByMargin(input.safeArea);
  const camera = new THREE.PerspectiveCamera(fovDegrees, canvas.widthPx / canvas.heightPx, FIT_NEAR_KM, FIT_FAR_KM);
  const target = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
  const inView = new THREE.Vector3();
  const projected = new THREE.Vector3();

  function projectBox(distanceKm: number): ProjectedBox {
    camera.position.copy(target).addScaledVector(direction, distanceKm);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const box: ProjectedBox = { isAllInFront: true, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const point of points) {
      inView.copy(point).applyMatrix4(camera.matrixWorldInverse);
      if (inView.z >= -camera.near) box.isAllInFront = false;
      projected.copy(point).project(camera);
      const pointX = ((projected.x + 1) / 2) * canvas.widthPx;
      const pointY = ((1 - projected.y) / 2) * canvas.heightPx;
      box.left = Math.min(box.left, pointX);
      box.right = Math.max(box.right, pointX);
      box.top = Math.min(box.top, pointY);
      box.bottom = Math.max(box.bottom, pointY);
    }
    return box;
  }

  let distanceKm = MIN_DISTANCE_KM;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let round = 0; round < FIT_ROUNDS; round += 1) {
    let nearKm = MIN_DISTANCE_KM;
    let farKm = MAX_DISTANCE_KM;
    for (let step = 0; step < DISTANCE_STEPS; step += 1) {
      const middleKm = (nearKm + farKm) / 2;
      const box = projectBox(middleKm);
      const fits = box.isAllInFront && box.right - box.left <= safe.right - safe.left && box.bottom - box.top <= safe.bottom - safe.top;
      if (fits) farKm = middleKm;
      else nearKm = middleKm;
    }
    distanceKm = farKm;
    const box = projectBox(distanceKm);
    const offsetX = (box.left + box.right) / 2 - (safe.left + safe.right) / 2;
    const offsetY = (box.top + box.bottom) / 2 - (safe.top + safe.bottom) / 2;
    const kmPerPx = (2 * distanceKm * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2)) / canvas.heightPx;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    // Sliding the camera and its target right moves the picture's content left.
    target.addScaledVector(right, offsetX * kmPerPx).addScaledVector(up, -offsetY * kmPerPx);
  }
  return { position: target.clone().addScaledVector(direction, distanceKm), target, fovDegrees };
}

/** What one shot frames: its subjects' points and the angles to try, in order of preference. */
export type ShotFraming = { points: THREE.Vector3[]; directions: THREE.Vector3[] };

function readVesselPoints(vessel: VesselSubject): THREE.Vector3[] {
  const halfHullKm = vessel.drawnLengthKm / 2;
  return [
    vessel.position.clone(),
    vessel.position.clone().addScaledVector(vessel.heading, halfHullKm),
    vessel.position.clone().addScaledVector(vessel.heading, -halfHullKm),
    vessel.position.clone().setY(vessel.position.y + SHIP_TOP_LENGTHS * vessel.drawnLengthKm),
  ];
}

function readChainPoints(anchor: AnchorSubject): THREE.Vector3[] {
  return [anchor.position.clone(), anchor.hawse.clone(), anchor.chainMiddle.clone()];
}

/** The horizontal unit direction the anchor is dragged in: from the anchor toward the hawse. */
function readDragDirection(anchor: AnchorSubject): THREE.Vector3 {
  const drag = new THREE.Vector3(anchor.hawse.x - anchor.position.x, 0, anchor.hawse.z - anchor.position.z);
  return drag.lengthSq() > 0 ? drag.normalize() : new THREE.Vector3(1, 0, 0);
}

function toDirections(azimuths: readonly number[], elevationDegrees: number, baseAzimuth = 0): THREE.Vector3[] {
  return azimuths.map((azimuth) => directionFrom(baseAzimuth + azimuth, elevationDegrees));
}

/**
 * Points that make a story at least `minimumSpanKm` across: a ship that never left its anchorage (Hai Hong Gong 66
 * salvaging a wreck) would otherwise pull the camera down onto one spot of seabed.
 */
function padToMinimumSpan(points: THREE.Vector3[], minimumSpanKm: number): THREE.Vector3[] {
  if (points.length === 0) return points;
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  if (Math.max(size.x, size.z) >= minimumSpanKm) return points;
  const centre = box.getCenter(new THREE.Vector3());
  const half = minimumSpanKm / 2;
  return [...points, centre.clone().setX(centre.x - half), centre.clone().setX(centre.x + half), centre.clone().setZ(centre.z - half), centre.clone().setZ(centre.z + half)];
}

function frameWholeStory(subjects: DirectorSubjects, includesVessel: boolean): THREE.Vector3[] {
  const cutPoints = subjects.cutPoints.flatMap((point) => point ?? []);
  const points = [...subjects.trackPoints, ...cutPoints, ...(includesVessel && subjects.vessel ? [subjects.vessel.position] : [])].map((point) => point.clone());
  return padToMinimumSpan(points, MIN_STORY_SPAN_KM);
}

/**
 * The subjects and angles of a shot at this moment, or null for the cut's close-up (it keeps its own camera) and for a
 * shot with nothing to frame. A follow or approach shot whose ship or anchor is not drawn falls back to what is.
 */
export function planShotFraming(shot: Shot, subjects: DirectorSubjects): ShotFraming | null {
  const establishing = (): ShotFraming => ({ points: frameWholeStory(subjects, true), directions: toDirections(ESTABLISHING.azimuths, ESTABLISHING.elevationDegrees) });
  switch (shot.kind) {
    case "establishing": {
      const framing = establishing();
      return framing.points.length > 0 ? framing : null;
    }
    case "follow": {
      const { vessel, anchor } = subjects;
      if (!vessel) return planShotFraming({ ...shot, kind: "establishing" }, subjects);
      const points = [...readVesselPoints(vessel), ...(anchor ? readChainPoints(anchor) : [])];
      return { points, directions: toDirections(FOLLOW.relativeAzimuths, FOLLOW.elevationDegrees, azimuthOf(vessel.heading)) };
    }
    case "approach": {
      const { vessel, anchor } = subjects;
      const cutPoint = subjects.cutPoints[shot.cutIndex];
      if (!anchor) {
        if (!vessel) return planShotFraming({ ...shot, kind: "establishing" }, subjects);
        return { points: [...readVesselPoints(vessel), ...(cutPoint ? [cutPoint.clone()] : [])], directions: toDirections(FOLLOW.relativeAzimuths, FOLLOW.elevationDegrees, azimuthOf(vessel.heading)) };
      }
      const chainLow = anchor.position.clone().lerp(anchor.chainMiddle, 0.5);
      const points = [anchor.position.clone(), chainLow, anchor.chainMiddle.clone(), ...(cutPoint ? [cutPoint.clone()] : [])];
      return { points, directions: toDirections(APPROACH.relativeAzimuths, APPROACH.elevationDegrees, azimuthOf(readDragDirection(anchor))) };
    }
    case "cut":
      return null;
    case "aftermath": {
      const points = frameWholeStory(subjects, false);
      return points.length > 0 ? { points, directions: toDirections(AFTERMATH.azimuths, AFTERMATH.elevationDegrees) } : null;
    }
    default: {
      const unhandledShot: never = shot;
      return unhandledShot;
    }
  }
}

/** A framed pose and how many of its subjects the relief hides from it. */
export type ChosenPose = { pose: CameraPose; hiddenCount: number; directionIndex: number };

/**
 * Fits the framing from each of its angles and keeps the one with the fewest subjects hidden by the relief; a tie
 * keeps the earlier, preferred angle. Null when no angle can be fitted.
 */
export function chooseLeastHiddenPose(input: {
  framing: ShotFraming;
  fovDegrees: number;
  canvas: CanvasSize;
  safeArea: SafeArea;
  isHidden: (point: THREE.Vector3, cameraPosition: THREE.Vector3) => boolean;
}): ChosenPose | null {
  const { framing, fovDegrees, canvas, safeArea, isHidden } = input;
  let best: ChosenPose | null = null;
  for (const [directionIndex, direction] of framing.directions.entries()) {
    const pose = fitCameraToPoints({ points: framing.points, direction, fovDegrees, canvas, safeArea });
    if (!pose) continue;
    const hiddenCount = framing.points.filter((point) => isHidden(point, pose.position)).length;
    if (best === null || hiddenCount < best.hiddenCount) best = { pose, hiddenCount, directionIndex };
    // Nothing beats a clear view: later angles are not fitted.
    if (hiddenCount === 0) break;
  }
  return best;
}

/** The anchor cam's pose (board 22): low behind the anchor, looking along the drag, the furrow below, the chain rising away. */
export function poseAnchorCam(anchor: AnchorSubject): CameraPose {
  const drag = readDragDirection(anchor);
  const position = anchor.position.clone().addScaledVector(drag, -ANCHOR_CAM_BEHIND_KM).add(new THREE.Vector3(0, ANCHOR_CAM_ABOVE_KM, 0));
  const target = anchor.position.clone().addScaledVector(drag, ANCHOR_CAM_AIM_AHEAD_KM);
  return { position, target, fovDegrees: ANCHOR_CAM_FOV_DEGREES };
}

/** The bridge view: from the wheelhouse, looking ahead over the bow at the water the ship is about to cross. */
export function poseBridgeView(vessel: VesselSubject): CameraPose {
  const lengthKm = vessel.drawnLengthKm;
  const position = vessel.position.clone().addScaledVector(vessel.heading, -BRIDGE_AFT_LENGTHS * lengthKm);
  position.y = vessel.position.y + BRIDGE_ABOVE_LENGTHS * lengthKm;
  const target = vessel.position.clone().addScaledVector(vessel.heading, BRIDGE_LOOK_AHEAD_LENGTHS * lengthKm);
  target.y = vessel.position.y;
  return { position, target, fovDegrees: BRIDGE_FOV_DEGREES };
}

/**
 * The names of the subjects a shot promises to show, as the viewer's lookdev hook names them (overview.ts and
 * close-up.ts, readSubjects), for the visibility check: the whole story's ends and cuts when establishing and in the
 * aftermath, the ship and its anchor while following, the anchor and the approached cut point on the approach, the
 * anchor and both torn ends in the close-up.
 */
export function listShotSubjectNames(shot: Shot, subjects: DirectorSubjects, cutLabels: readonly string[]): string[] {
  const cutPointName = (cutIndex: number) => `${cutLabels[cutIndex] ?? ""} cut point`;
  const drawnCutPointNames = cutLabels.flatMap((_label, cutIndex) => (subjects.cutPoints[cutIndex] ? [cutPointName(cutIndex)] : []));
  const trackEnds = subjects.trackPoints.length > 0 ? ["track 0%", "track 100%"] : [];
  switch (shot.kind) {
    case "establishing":
      return [...trackEnds, ...drawnCutPointNames, ...(subjects.vessel ? ["vessel"] : [])];
    case "follow":
      return subjects.vessel ? ["vessel", ...(subjects.anchor ? ["anchor"] : [])] : [...trackEnds, ...drawnCutPointNames];
    case "approach":
      return subjects.anchor ? ["anchor", ...(subjects.cutPoints[shot.cutIndex] ? [cutPointName(shot.cutIndex)] : [])] : subjects.vessel ? ["vessel"] : [...trackEnds, ...drawnCutPointNames];
    case "cut":
      return ["anchor", "torn end west", "torn end east"];
    case "aftermath":
      return [...trackEnds, ...drawnCutPointNames];
    default: {
      const unhandledShot: never = shot;
      return unhandledShot;
    }
  }
}

/** Where a scene point lands on a canvas seen through a pose, in CSS px; null at or behind the near plane. */
export function projectThroughPose(pose: CameraPose, canvas: CanvasSize, point: THREE.Vector3): { x: number; y: number } | null {
  const camera = new THREE.PerspectiveCamera(pose.fovDegrees, canvas.widthPx / canvas.heightPx, FIT_NEAR_KM, FIT_FAR_KM);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  const inView = point.clone().applyMatrix4(camera.matrixWorldInverse);
  if (inView.z >= -camera.near) return null;
  const projected = point.clone().project(camera);
  return { x: ((projected.x + 1) / 2) * canvas.widthPx, y: ((1 - projected.y) / 2) * canvas.heightPx };
}
