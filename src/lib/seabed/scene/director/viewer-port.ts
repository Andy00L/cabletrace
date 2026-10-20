import type * as THREE from "three";

// What the camera director and the anchor cam need from the 3D viewer (src/lib/seabed/scene/viewer.ts), as one typed
// port. The director module never reaches into the viewer's scene: it reads subjects and writes camera poses through
// this interface only, so its framing math stays testable without a renderer. Scene units are the overview's
// kilometres (x east, y up, z south), as in overview.ts.

/** A camera: where it stands, the point it looks at, and its vertical field of view. */
export type CameraPose = { position: THREE.Vector3; target: THREE.Vector3; fovDegrees: number };

/** The drawn canvas in CSS px. */
export type CanvasSize = { widthPx: number; heightPx: number };

/**
 * The part of the canvas no control or card covers, in canvas CSS px from its top left corner. The director keeps
 * every subject of a shot inside it.
 */
export type SafeArea = { left: number; top: number; right: number; bottom: number };

/** The ship on the last drawn frame: its waterline point amidships, its unit heading on the water, its drawn length. */
export type VesselSubject = { position: THREE.Vector3; heading: THREE.Vector3; drawnLengthKm: number };

/** The anchor on the seabed and the chain up to the hawse pipe, while the anchor is down. */
export type AnchorSubject = { position: THREE.Vector3; hawse: THREE.Vector3; chainMiddle: THREE.Vector3 };

/** Everything a shot can frame, at the replay moment the viewer last drew. */
export type DirectorSubjects = {
  /** Null before the ship's first position. */
  vessel: VesselSubject | null;
  /** Null while the anchor is stowed. */
  anchor: AnchorSubject | null;
  /** One point per case cut, in case order (`ReplaySceneInput.cuts`), drawn or not yet. */
  cutPoints: readonly THREE.Vector3[];
  /** Points evenly spaced along the whole track, drawn or not yet, first to last. */
  trackPoints: readonly THREE.Vector3[];
};

/** What the anchor cam states at a moment, from the engine's own anchor model (overview.ts, readAnchorFacts). */
export type AnchorFacts = {
  waterDepthMetres: number;
  chainPaidOutMetres: number;
  laybackMetres: number;
  nearestCable: { name: string; distanceMetres: number } | null;
  anchorSpeedKnots: number;
};

/** Where a scene point lands on the canvas, in canvas CSS px; `isInFront` is false at or behind the camera's near plane. */
export type CanvasPoint = { x: number; y: number; isInFront: boolean };

/**
 * A second picture of the same scene from another camera (the anchor cam). The viewer draws it once per frame into
 * `canvas` (a 2D canvas the console owns), at `widthPx` by `heightPx` CSS px and the viewer's pixel ratio, from the
 * pose `readPose` returns for that frame; a null pose skips the frame.
 */
export type SecondView = {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
  readPose: () => CameraPose | null;
};

/** One frame the viewer is about to draw: the replay moment and the wall clock (performance.now() ms). */
export type ViewerFrame = { atMs: number; nowMs: number };

/** The interface the director needs from the viewer. */
export type DirectorViewerPort = {
  /** The subjects at the last drawn moment. */
  readSubjects: () => DirectorSubjects;
  /** Whether the relief rises above the sight line from `cameraPosition` to `point` (overview.ts, isBehindRelief). */
  isHiddenByRelief: (point: THREE.Vector3, cameraPosition: THREE.Vector3) => boolean;
  /** Projects a scene point through the overview camera as last drawn. */
  projectToCanvas: (point: THREE.Vector3) => CanvasPoint;
  readCanvasSize: () => CanvasSize;
  /** The overview camera's pose on the last drawn frame, where a flight starts. */
  readCameraPose: () => CameraPose;
  /** The vertical field of view the overview uses at this canvas aspect (viewer.ts, fitOverviewFov). */
  readOverviewFovDegrees: () => number;
  /**
   * Puts the overview camera on a pose for the frame being drawn and keeps it there until the next call; null hands
   * the camera back to the current view's own camera (presets, the follow camera, the orbit controls).
   */
  setCameraPose: (pose: CameraPose | null) => void;
  /** Turns the close-up's camera about its target by this angle (degrees, about the vertical axis) from its preset. */
  setCloseUpOrbit: (degrees: number) => void;
  /** The anchor cam's numbers at a moment, or null while the anchor is not down. */
  readAnchorFacts: (atMs: number) => AnchorFacts | null;
  /** Starts or stops drawing a second view; null stops it. */
  setSecondView: (view: SecondView | null) => void;
  /** Called before each frame is drawn; returns the unsubscribe function. */
  onBeforeFrame: (listener: (frame: ViewerFrame) => void) => () => void;
};
