import * as THREE from "three";

// The camera of a side-on photograph of a ship, in the photograph's own terms: where it stood relative to the ship
// (distance from amidships and height above the water, metres), how the ship lay (its heading off broadside), where
// the lens pointed (pan and tilt off the ship's midpoint at eye height) and its roll, its vertical field of view, and
// the draught the ship floated at that day. The ship's bow points to the photograph's left at yaw 0.

export type PhotoCamera = {
  distanceMetres: number;
  heightMetres: number;
  /** The ship's heading off broadside (degrees, positive turns the bow away from the camera). */
  yawDegrees: number;
  panDegrees: number;
  tiltDegrees: number;
  rollDegrees: number;
  verticalFovDegrees: number;
  draughtMetres: number;
};

const RADIANS_PER_DEGREE = Math.PI / 180;

/** A three.js camera on the photograph's pose, looking at a ship built at the origin (bow +x, as build-ship.ts builds it). */
export function readCameraPose(camera: PhotoCamera, aspect: number): THREE.PerspectiveCamera {
  const pose = new THREE.PerspectiveCamera(camera.verticalFovDegrees, aspect, 10, camera.distanceMetres * 4);
  // The ship's bow (+x) points to the left: the camera stands on the ship's -z side (port), looking toward +z, turned
  // about the ship by the yaw.
  const yaw = camera.yawDegrees * RADIANS_PER_DEGREE;
  pose.position.set(Math.sin(yaw) * camera.distanceMetres, camera.heightMetres, -Math.cos(yaw) * camera.distanceMetres);
  pose.lookAt(0, camera.heightMetres, 0);
  pose.rotateY(-camera.panDegrees * RADIANS_PER_DEGREE);
  pose.rotateX(camera.tiltDegrees * RADIANS_PER_DEGREE);
  pose.rotateZ(camera.rollDegrees * RADIANS_PER_DEGREE);
  pose.updateMatrixWorld();
  return pose;
}
