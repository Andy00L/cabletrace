import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { writeUnitVector } from "@/lib/globe/sphere";
import type { GlobeLine } from "@/lib/globe/world-lines";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

// The cables and pipelines on the /live globe, in their data colors at their token widths (docs/UI_DESIGN_SYSTEM.md,
// Data: power cable 2.5 px, telecom cable 1.5 px, pipeline 3 px), and the signal on the cables the replays watch: a
// faint 12 px halo of the cable color at 12% and a short light that runs along the line (Signature element).

// Lines sit just above the unit sphere, under the ships.
export const LINE_LIFT = 1.0006;
// Segments longer than this (degrees) are cut into pieces that follow the surface; a straight chord between two far
// points would dip under the globe. 0.5 degrees is 55 km, a few pixels from orbit.
const MAX_SEGMENT_DEGREES = 0.5;
const LINE_WIDTH_PX: Readonly<Record<SeabedLineKind, number>> = { power: 2.5, telecom: 1.5, pipeline: 3 };
const SIGNAL_HALO_PX = 12;
const SIGNAL_HALO_OPACITY = 0.12;
const SIGNAL_LIGHT_PX = 7;
// The light takes this long to run a line's length, as in the replay (SIGNAL_LAP_SECONDS, src/lib/seabed/scene/overview.ts).
const SIGNAL_LAP_SECONDS = 7;
// Where the light rests when nothing moves (reduced motion, a software renderer), as the replay does.
const SIGNAL_REST_SHARE = 0.3;
// From orbit the world's lines would merge into blots at full width: they are drawn at this share of their width at
// the home distance and reach the full token width from WIDTH_FULL_DISTANCE inward.
const WIDTH_SHARE_FROM_ORBIT = 0.5;
const WIDTH_FULL_DISTANCE = 1.5;
// A screen-space line thinner than this many device pixels breaks into dashes where it runs near the horizontal on a
// software renderer (pixel ratio 0.75, no antialiasing), so no line is drawn thinner.
const MIN_LINE_DEVICE_PX = 1.5;

/** A line's parts as points on the sphere (3 numbers each, times LINE_LIFT), subdivided so they follow the surface. */
export type SurfaceLine = { line: GlobeLine; parts: Float32Array[] };

/** Cuts a part into pieces of at most MAX_SEGMENT_DEGREES, interpolated in longitude and latitude as mapped. */
function toSurfacePart(points: readonly number[]): Float32Array {
  const surface: number[] = [];
  const scratch = new Float32Array(3);
  const pushPoint = (longitude: number, latitude: number) => {
    writeUnitVector(longitude, latitude, scratch, 0);
    surface.push((scratch[0] ?? 0) * LINE_LIFT, (scratch[1] ?? 0) * LINE_LIFT, (scratch[2] ?? 0) * LINE_LIFT);
  };
  pushPoint(points[0] ?? 0, points[1] ?? 0);
  for (let index = 2; index + 1 < points.length; index += 2) {
    const fromLongitude = points[index - 2] ?? 0;
    const fromLatitude = points[index - 1] ?? 0;
    let deltaLongitude = (points[index] ?? 0) - fromLongitude;
    if (deltaLongitude > 180) deltaLongitude -= 360;
    if (deltaLongitude < -180) deltaLongitude += 360;
    const deltaLatitude = (points[index + 1] ?? 0) - fromLatitude;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(deltaLongitude), Math.abs(deltaLatitude)) / MAX_SEGMENT_DEGREES));
    for (let step = 1; step <= steps; step += 1) pushPoint(fromLongitude + (deltaLongitude * step) / steps, fromLatitude + (deltaLatitude * step) / steps);
  }
  return Float32Array.from(surface);
}

export function toSurfaceLines(lines: readonly GlobeLine[]): SurfaceLine[] {
  return lines.map((line) => ({ line, parts: line.parts.filter((part) => part.length >= 4).map(toSurfacePart) }));
}

/** Every segment of the given parts as pairs of points, the layout LineSegmentsGeometry takes. */
function toSegmentPositions(parts: readonly Float32Array[]): Float32Array {
  const segmentCount = parts.reduce((sum, part) => sum + Math.max(0, part.length / 3 - 1), 0);
  const positions = new Float32Array(segmentCount * 6);
  let offset = 0;
  for (const part of parts) {
    for (let index = 0; index + 5 < part.length; index += 3) {
      positions.set(part.subarray(index, index + 6), offset);
      offset += 6;
    }
  }
  return positions;
}

type SignalPath = { points: Float32Array; cumulative: Float32Array; length: number };

function toSignalPath(part: Float32Array): SignalPath {
  const pointCount = part.length / 3;
  const cumulative = new Float32Array(pointCount);
  for (let index = 1; index < pointCount; index += 1) {
    const offset = index * 3;
    cumulative[index] =
      (cumulative[index - 1] ?? 0) +
      Math.hypot((part[offset] ?? 0) - (part[offset - 3] ?? 0), (part[offset + 1] ?? 0) - (part[offset - 2] ?? 0), (part[offset + 2] ?? 0) - (part[offset - 1] ?? 0));
  }
  return { points: part, cumulative, length: cumulative[pointCount - 1] ?? 0 };
}

/** Writes the point at `share` of a path's length into `target` at `offset`. */
function writePointAlong(path: SignalPath, share: number, target: Float32Array, offset: number): void {
  const distance = share * path.length;
  let index = 1;
  while (index < path.cumulative.length - 1 && (path.cumulative[index] ?? 0) < distance) index += 1;
  const start = path.cumulative[index - 1] ?? 0;
  const span = (path.cumulative[index] ?? 0) - start;
  const amount = span > 0 ? (distance - start) / span : 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const from = path.points[(index - 1) * 3 + axis] ?? 0;
    const to = path.points[index * 3 + axis] ?? from;
    target[offset + axis] = from + (to - from) * amount;
  }
}

/** A point faces the camera when its dot product with the camera position exceeds the lift (it is on the near side). */
function isFacing(points: Float32Array, cameraPosition: THREE.Vector3): boolean {
  return (points[0] ?? 0) * cameraPosition.x + (points[1] ?? 0) * cameraPosition.y + (points[2] ?? 0) * cameraPosition.z > LINE_LIFT;
}

const SIGNAL_VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

// A soft round light; the color is written as given (sRGB hex), as the ship dots are.
const SIGNAL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float alpha = 1.0 - smoothstep(0.18, 0.5, length(gl_PointCoord - 0.5));
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** `over` laid on `under` at `share` opacity, mixed in sRGB bytes as the browser composites: "#rrggbb". */
function mixSrgbHex(under: string, over: string, share: number): string {
  const underValue = Number.parseInt(under.slice(1), 16);
  const overValue = Number.parseInt(over.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => Math.round(((underValue >> shift) & 255) * (1 - share) + ((overValue >> shift) & 255) * share));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function toRawColor(hex: string): THREE.Vector3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

export type GlobeLineLayer = {
  object: THREE.Group;
  /** The lines as drawn, for picking. */
  surfaceLines: SurfaceLine[];
  /** Sets widths for the camera distance and moves the signal lights; true while the lights are running. */
  update: (options: { nowMs: number; cameraPosition: THREE.Vector3; homeDistance: number; isCalm: boolean; pixelRatio: number }) => boolean;
  setResolution: (widthPx: number, heightPx: number) => void;
  dispose: () => void;
};

/** Builds the line layer: one draw per kind for every line, then the watched cables' halos and lights on top. */
export function createGlobeLineLayer(lines: readonly GlobeLine[]): GlobeLineLayer {
  const object = new THREE.Group();
  const surfaceLines = toSurfaceLines(lines);
  const materials: LineMaterial[] = [];
  const geometries: LineSegmentsGeometry[] = [];
  const widthBindings: { material: LineMaterial; widthPx: number; scalesWithDistance: boolean }[] = [];

  const addSegments = (parts: Float32Array[], material: LineMaterial, renderOrder: number) => {
    const positions = toSegmentPositions(parts);
    if (positions.length === 0) return;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const segments = new LineSegments2(geometry, material);
    segments.renderOrder = renderOrder;
    object.add(segments);
    geometries.push(geometry);
  };
  const createLineMaterial = (color: string, widthPx: number, scalesWithDistance: boolean, writesDepth = true) => {
    const material = new LineMaterial({ color: new THREE.Color(color), linewidth: widthPx, worldUnits: false, depthWrite: writesDepth });
    materials.push(material);
    widthBindings.push({ material, widthPx, scalesWithDistance });
    return material;
  };
  const colorOf = (kind: SeabedLineKind) => (kind === "pipeline" ? WEBGL_COLORS.pipeline : WEBGL_COLORS.cable);

  // The world's lines: pipelines first so a cable crossing one stays on top.
  for (const kind of ["pipeline", "power", "telecom"] as const) {
    const parts = surfaceLines.filter((surfaceLine) => !surfaceLine.line.isWatched && surfaceLine.line.kind === kind).flatMap((surfaceLine) => surfaceLine.parts);
    addSegments(parts, createLineMaterial(colorOf(kind), LINE_WIDTH_PX[kind], true), 1);
  }

  // The watched lines: the cables' halos, then every watched line at full width, then the lights.
  const watched = surfaceLines.filter((surfaceLine) => surfaceLine.line.isWatched);
  const watchedCables = watched.filter((surfaceLine) => surfaceLine.line.kind !== "pipeline");
  // The halo is drawn opaque in the color the cable at 12% makes over the sea: a translucent line would darken
  // wherever two of its segments, or two copies of a line from overlapping seabed areas, overlap. It writes no depth,
  // so the cable drawn at the same height over it never flickers through.
  addSegments(
    watchedCables.flatMap((surfaceLine) => surfaceLine.parts),
    createLineMaterial(mixSrgbHex(WEBGL_COLORS.depth40, WEBGL_COLORS.cable, SIGNAL_HALO_OPACITY), SIGNAL_HALO_PX, true, false),
    2,
  );
  for (const kind of ["pipeline", "power", "telecom"] as const) {
    const parts = watched.filter((surfaceLine) => surfaceLine.line.kind === kind).flatMap((surfaceLine) => surfaceLine.parts);
    addSegments(parts, createLineMaterial(colorOf(kind), LINE_WIDTH_PX[kind], false), 3);
  }

  const signalPaths = watchedCables.flatMap((surfaceLine) => surfaceLine.parts).filter((part) => part.length >= 6).map(toSignalPath);
  const signalPositions = new Float32Array(signalPaths.length * 3);
  const signalGeometry = new THREE.BufferGeometry();
  signalGeometry.setAttribute("position", new THREE.BufferAttribute(signalPositions, 3));
  const signalMaterial = new THREE.ShaderMaterial({
    uniforms: { uPointSize: { value: SIGNAL_LIGHT_PX }, uColor: { value: toRawColor(SCENE_COLORS.signalCore) } },
    vertexShader: SIGNAL_VERTEX_SHADER,
    fragmentShader: SIGNAL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const signalLights = new THREE.Points(signalGeometry, signalMaterial);
  signalLights.frustumCulled = false;
  signalLights.renderOrder = 4;
  signalLights.visible = signalPaths.length > 0;
  object.add(signalLights);
  let lastWidthScale = -1;
  let lastPixelRatio = -1;

  return {
    object,
    surfaceLines,
    update({ nowMs, cameraPosition, homeDistance, isCalm, pixelRatio }) {
      const cameraDistance = cameraPosition.length();
      const closeness = Math.min(1, Math.max(0, (homeDistance - cameraDistance) / (homeDistance - WIDTH_FULL_DISTANCE)));
      const widthScale = WIDTH_SHARE_FROM_ORBIT + (1 - WIDTH_SHARE_FROM_ORBIT) * closeness;
      if (widthScale !== lastWidthScale || pixelRatio !== lastPixelRatio) {
        lastWidthScale = widthScale;
        lastPixelRatio = pixelRatio;
        const minWidthPx = MIN_LINE_DEVICE_PX / pixelRatio;
        widthBindings.forEach(({ material, widthPx, scalesWithDistance }) => {
          material.linewidth = Math.max(minWidthPx, widthPx * (scalesWithDistance ? widthScale : 1));
        });
      }
      signalMaterial.uniforms.uPointSize.value = SIGNAL_LIGHT_PX * pixelRatio;
      const share = isCalm ? SIGNAL_REST_SHARE : (nowMs / 1000 / SIGNAL_LAP_SECONDS) % 1;
      signalPaths.forEach((path, index) => writePointAlong(path, share, signalPositions, index * 3));
      signalGeometry.attributes.position.needsUpdate = true;
      // The lights only keep the globe drawing while one of them is on the side facing the camera.
      return !isCalm && signalPaths.some((path) => isFacing(path.points, cameraPosition));
    },
    setResolution(widthPx, heightPx) {
      materials.forEach((material) => material.resolution.set(widthPx, heightPx));
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      signalGeometry.dispose();
      signalMaterial.dispose();
    },
  };
}
