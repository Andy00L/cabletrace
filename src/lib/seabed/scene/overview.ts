import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { positionAtTime, type ReplayCut, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import { makeLabel, makeStackedLabel } from "@/lib/seabed/scene/labels";
import { buildAnchorModel } from "@/lib/seabed/scene/models";
import { createProgressLine, type ProgressLine } from "@/lib/seabed/scene/progress-line";
import { LAND_RAMP, SCENE_COLORS, SEABED_RAMP } from "@/lib/seabed/scene/scene-colors";
import { buildTankerModel } from "@/lib/seabed/scene/tanker-model";
import { createTerrainMaterial } from "@/lib/seabed/scene/terrain-material";
import { thinTubeWithDistance } from "@/lib/seabed/scene/tube-thinning";
import { createWake } from "@/lib/seabed/scene/wake";
import type { SeabedFeatures } from "@/lib/seabed/seabed-data";
import { SCENE_SCALES } from "@/lib/seabed/scene-scales";
import { clipToBlock, densifyScenePoints, elevationToSceneY, type Projection, type ScenePoint } from "@/lib/seabed/terrain";

// Sediment the overview block stands on, below the deepest sounding (km).
const BLOCK_BASE_THICKNESS_KM = 2.6;
// Lines are resampled every 300 m so they follow the seabed.
const LINE_STEP_KM = 0.3;
// Points on each side used to even out a line's height along the seabed.
const LINE_HEIGHT_SMOOTHING_POINTS = 4;
const POWER_CABLE_RADIUS_KM = 0.13;
const TELECOM_CABLE_RADIUS_KM = 0.075;
const PIPELINE_RADIUS_KM = 0.14;
const SIGNAL_HALO_RADIUS_KM = 0.42;
// A cut within this distance of a line splits it there.
const CUT_MATCH_KM = 1.5;
// The track and the furrow are screen-width lines (progress-line.ts), revealed segment by segment.
const TRACK_SEGMENTS = 600;
const TRACK_WIDTH_PX = 2;
// The track lies just above the water surface (km), under the wake.
const TRACK_SURFACE_LIFT = 0.006;
const FURROW_SEGMENTS = 800;
const FURROW_WIDTH_PX = 3;
// The furrow floats this far above the seabed (km) so ridges between samples do not hide it.
const FURROW_SEABED_LIFT = 0.09;
const PLUME_PARTICLE_COUNT = 140;
// Heading is read over this span around the current moment, so a reconstructed corner does not snap the hull.
const HEADING_SPAN_MS = 2 * 60 * 1000;
// The light along the healthy cable takes this long to run its length.
const SIGNAL_LAP_SECONDS = 7;
// Model metres to scene kilometres. The vessel is drawn 6 times its real size and the anchor 30 times, so
// both read across a 55 km block; the disclosure under the view says so.
const METRES_TO_KM = 1 / 1000;
const SHIP_DRAWN_SCALE = SCENE_SCALES.shipDrawnScale;
const ANCHOR_DRAWN_SCALE = SCENE_SCALES.anchorDrawnScale;
const SHIP_LABEL_HEIGHT_METRES = 55;
// The wake follows the last 13 minutes of the path, sampled every 20 s.
const WAKE_STEP_MS = 20 * 1000;
const WAKE_SAMPLE_COUNT = 40;
const WAKE_HALF_WIDTH_KM = 16 * METRES_TO_KM * SHIP_DRAWN_SCALE;
// The overview camera looks from the south-east, down about 35 degrees (the approved prototype angle).
const OVERVIEW_DIRECTION = new THREE.Vector3(14, 19, 26).normalize();
const OVERVIEW_TARGET_Y = -1.8;
// Room kept around the track when the overview frames it (km), and the smallest framed radius.
const OVERVIEW_PADDING_KM = 6;
const OVERVIEW_MIN_RADIUS_KM = 12;
// Vertical field of view of the overview camera (degrees); the viewer widens it on narrow screens.
export const OVERVIEW_FOV_DEGREES = 32;
// The top view fits the block for this aspect ratio, a little wider than the replay card.
const TOP_VIEW_ASPECT = 1.6;

/** Where the vessel is and which way it heads, for the camera that follows it. */
export type VesselFrame = { position: THREE.Vector3; heading: ScenePoint };

export type OverviewViewName = "overview" | "top";

export type OverviewScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  presets: Record<OverviewViewName, { position: THREE.Vector3; target: THREE.Vector3 }>;
  primaryCutScene: ScenePoint;
  /** Unit direction of the track at the primary cut (falls back to east when the track is too short). */
  trackDirection: ScenePoint;
  /** Unit direction of the cut cable at the primary cut. */
  cableDirection: ScenePoint;
  /** The vessel's last drawn frame, or null while it is not on the map yet. */
  readVesselFrame: () => VesselFrame | null;
  update: (atMs: number, deltaSeconds: number, nowSeconds: number) => void;
};

type OverviewOptions = {
  renderer: THREE.WebGLRenderer;
  domElement: HTMLElement;
  features: SeabedFeatures;
  elevations: Float32Array;
  projection: Projection;
  sampleElevationMetres: (sceneX: number, sceneZ: number) => number;
  input: ReplaySceneInput;
  softDot: THREE.Texture;
  prefersReducedMotion: boolean;
};

function buildRamp(stops: readonly [number, string][]) {
  return stops.map(([value, hex]) => ({ value, color: new THREE.Color(hex) }));
}

function sampleRamp(ramp: { value: number; color: THREE.Color }[], value: number, target: THREE.Color): THREE.Color {
  const first = ramp[0];
  if (!first || value <= first.value) return first ? target.copy(first.color) : target;
  for (let index = 1; index < ramp.length; index += 1) {
    const lower = ramp[index - 1];
    const upper = ramp[index];
    if (lower && upper && value <= upper.value) return target.copy(lower.color).lerp(upper.color, (value - lower.value) / (upper.value - lower.value));
  }
  const last = ramp[ramp.length - 1];
  return last ? target.copy(last.color) : target;
}

function buildTerrainMesh(elevations: Float32Array, features: SeabedFeatures, projection: Projection): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(projection.widthKm, projection.depthKm, features.grid.width - 1, features.grid.height - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const seabedRamp = buildRamp(SEABED_RAMP);
  const landRamp = buildRamp(LAND_RAMP);
  const vertexColor = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const elevation = elevations[index] ?? 0;
    positions.setY(index, elevationToSceneY(elevation));
    if (elevation < 0) sampleRamp(seabedRamp, -elevation, vertexColor);
    else sampleRamp(landRamp, elevation, vertexColor);
    vertexColor.toArray(colors, index * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("elevation", new THREE.BufferAttribute(elevations, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, createTerrainMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The four cut faces of the block: from the terrain edge down to the base, darker toward the base.
function buildBlockSides(terrain: THREE.Mesh, features: SeabedFeatures, baseY: number): THREE.Mesh {
  const positions = terrain.geometry.getAttribute("position");
  const { width, height } = features.grid;
  const readVertex = (row: number, column: number) => {
    const index = row * width + column;
    return { x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) };
  };
  const edges = [
    Array.from({ length: width }, (_slot, column) => readVertex(0, column)),
    Array.from({ length: width }, (_slot, column) => readVertex(height - 1, column)),
    Array.from({ length: height }, (_slot, row) => readVertex(row, 0)),
    Array.from({ length: height }, (_slot, row) => readVertex(row, width - 1)),
  ];
  const topColor = new THREE.Color(SCENE_COLORS.blockTop).toArray();
  const baseColor = new THREE.Color(SCENE_COLORS.blockBase).toArray();
  const vertices: number[] = [];
  const colors: number[] = [];
  for (const edge of edges) {
    for (let index = 0; index < edge.length - 1; index += 1) {
      const start = edge[index];
      const end = edge[index + 1];
      if (!start || !end) continue;
      vertices.push(start.x, start.y, start.z, end.x, end.y, end.z, start.x, baseY, start.z);
      vertices.push(end.x, end.y, end.z, end.x, baseY, end.z, start.x, baseY, start.z);
      colors.push(...topColor, ...topColor, ...baseColor, ...topColor, ...baseColor, ...baseColor);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  return mesh;
}

function buildWater(projection: Projection, deepestY: number): THREE.Group {
  const inset = 0.04;
  const height = -deepestY;
  const geometry = new THREE.BoxGeometry(projection.widthKm - inset, height, projection.depthKm - inset);
  geometry.translate(0, -height / 2, 0);
  const water = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({ color: SCENE_COLORS.water, transparent: true, opacity: 0.16, roughness: 0.16, metalness: 0, depthWrite: false }),
  );
  water.renderOrder = 2;
  const halfWidth = projection.widthKm / 2;
  const halfDepth = projection.depthKm / 2;
  const rimPoints = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
    [-halfWidth, -halfDepth],
  ].map(([pointX = 0, pointZ = 0]) => new THREE.Vector3(pointX, 0.01, pointZ));
  const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPoints), new THREE.LineBasicMaterial({ color: SCENE_COLORS.waterRim, transparent: true, opacity: 0.85 }));
  const group = new THREE.Group();
  group.add(water, rim);
  return group;
}

// A tube resting on the seabed; its height is evened out along the line so it does not jitter over every ridge.
function createSeabedTube(points: readonly ScenePoint[], radius: number, material: THREE.Material, sampleSeabedHeight: (sceneX: number, sceneZ: number) => number) {
  const rawHeights = points.map((point) => sampleSeabedHeight(point.x, point.z));
  const vectors = points.map((point, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -LINE_HEIGHT_SMOOTHING_POINTS; offset <= LINE_HEIGHT_SMOOTHING_POINTS; offset += 1) {
      const neighbourHeight = rawHeights[index + offset];
      if (neighbourHeight === undefined) continue;
      sum += neighbourHeight;
      count += 1;
    }
    const restingHeight = Math.max(sum / count, (rawHeights[index] ?? 0) - 0.04);
    return new THREE.Vector3(point.x, restingHeight + radius + 0.04, point.z);
  });
  const curve = new THREE.CatmullRomCurve3(vectors, false, "centripetal");
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, vectors.length * 2), radius, 8, false), material);
  mesh.castShadow = true;
  return { mesh, curve };
}

function nearestIndex(points: readonly ScenePoint[], target: ScenePoint): { index: number; distanceKm: number } {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return { index: bestIndex, distanceKm: bestDistance };
}

// Candidate spots along each run, as a share of its length, and the spacing of the track points labels avoid (km).
const LABEL_CANDIDATES = [0.15, 0.3, 0.5, 0.7, 0.85];
const LABEL_BUSY_STEP_KM = 2;

/** The point on the curves farthest from every busy point, or null when there are no curves. */
function findQuietLabelPoint(curves: readonly THREE.CatmullRomCurve3[], busyPoints: readonly ScenePoint[]): THREE.Vector3 | null {
  let bestPoint: THREE.Vector3 | null = null;
  let bestClearance = Number.NEGATIVE_INFINITY;
  for (const curve of curves) {
    for (const share of LABEL_CANDIDATES) {
      const candidate = curve.getPointAt(share);
      const clearance = busyPoints.reduce((nearest, busy) => Math.min(nearest, Math.hypot(busy.x - candidate.x, busy.z - candidate.z)), Number.POSITIVE_INFINITY);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestPoint = candidate;
      }
    }
  }
  return bestPoint;
}

function unitDirection(from: ScenePoint, to: ScenePoint, fallback: ScenePoint): ScenePoint {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  return length > 1e-6 ? { x: (to.x - from.x) / length, z: (to.z - from.z) / length } : fallback;
}

export function buildOverview(options: OverviewOptions): OverviewScene {
  const { renderer, features, elevations, projection, sampleElevationMetres, input, softDot, prefersReducedMotion } = options;
  const sampleSeabedHeight = (sceneX: number, sceneZ: number) => elevationToSceneY(sampleElevationMetres(sceneX, sceneZ));
  const deepestElevation = elevations.reduce((deepest, elevation) => Math.min(deepest, elevation), 0);
  const deepestY = elevationToSceneY(deepestElevation);
  const baseY = deepestY - BLOCK_BASE_THICKNESS_KM;
  const toScene = (longitude: number, latitude: number) => projection.toScene(longitude, latitude);

  const scene = new THREE.Scene();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  environmentGenerator.dispose();
  scene.environmentIntensity = 0.38;
  scene.add(new THREE.HemisphereLight(SCENE_COLORS.skyLight, SCENE_COLORS.groundLight, 0.95));
  const sunLight = new THREE.DirectionalLight(SCENE_COLORS.skyLight, 2.1);
  const blockRadiusKm = Math.hypot(projection.widthKm, projection.depthKm) / 2;
  sunLight.position.set(-42, 78, -26).setLength(blockRadiusKm * 1.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -blockRadiusKm, right: blockRadiusKm, top: blockRadiusKm, bottom: -blockRadiusKm, near: 1, far: blockRadiusKm * 3.2 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight);

  const terrain = buildTerrainMesh(elevations, features, projection);
  scene.add(terrain, buildBlockSides(terrain, features, baseY), buildWater(projection, deepestY));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(blockRadiusKm * 6, blockRadiusKm * 6), new THREE.ShadowMaterial({ opacity: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = baseY - 0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // One material per tube radius: each narrows with camera distance from its own radius (tube-thinning.ts).
  const createCableMaterial = (radiusKm: number) =>
    thinTubeWithDistance(new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.cable, emissive: WEBGL_COLORS.cable, emissiveIntensity: 0.28, roughness: 0.38, metalness: 0.1 }), radiusKm);
  const cableMaterials = { power: createCableMaterial(POWER_CABLE_RADIUS_KM), telecom: createCableMaterial(TELECOM_CABLE_RADIUS_KM) };
  const pipelineMaterial = thinTubeWithDistance(
    new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.pipeline, emissive: WEBGL_COLORS.pipeline, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.1 }),
    PIPELINE_RADIUS_KM,
  );

  const primaryCut = input.cuts[0];
  const primaryCutScene = toScene(primaryCut.longitude, primaryCut.latitude);
  let cableDirection: ScenePoint = { x: 1, z: 0 };
  let signalCurve: THREE.CatmullRomCurve3 | null = null;
  let signalStopCurve: THREE.CatmullRomCurve3 | null = null;
  // Each cut cable swaps its intact tube for two pieces once its cut time has passed.
  const cutSwitches: { cut: ReplayCut; intact: THREE.Object3D[]; pieces: THREE.Object3D[] }[] = [];
  const pipelineCurves = new Map<string, THREE.CatmullRomCurve3[]>();

  for (const line of features.lines) {
    const scenePoints = densifyScenePoints(line.points.map(([longitude, latitude]) => toScene(longitude, latitude)), LINE_STEP_KM);
    for (const run of clipToBlock(scenePoints, projection)) {
      if (line.kind === "pipeline") {
        const pipeline = createSeabedTube(run, PIPELINE_RADIUS_KM, pipelineMaterial, sampleSeabedHeight);
        scene.add(pipeline.mesh);
        pipelineCurves.set(line.name, [...(pipelineCurves.get(line.name) ?? []), pipeline.curve]);
        continue;
      }
      const radius = line.kind === "power" ? POWER_CABLE_RADIUS_KM : TELECOM_CABLE_RADIUS_KM;
      const cableMaterial = cableMaterials[line.kind];
      const intact = createSeabedTube(run, radius, cableMaterial, sampleSeabedHeight);
      scene.add(intact.mesh);
      const matchingCut = input.cuts
        .filter((cut) => cut.cableName === line.name)
        .map((cut) => ({ cut, nearest: nearestIndex(run, toScene(cut.longitude, cut.latitude)) }))
        .find((match) => match.nearest.distanceKm < CUT_MATCH_KM);
      if (!matchingCut) continue;

      const { cut, nearest } = matchingCut;
      const canSplit = nearest.index > 3 && nearest.index < run.length - 4;
      if (!canSplit) continue;
      const before = createSeabedTube(run.slice(0, nearest.index - 1), radius, cableMaterial, sampleSeabedHeight);
      const after = createSeabedTube(run.slice(nearest.index + 2), radius, cableMaterial, sampleSeabedHeight);
      before.mesh.visible = false;
      after.mesh.visible = false;
      scene.add(before.mesh, after.mesh);
      const intactObjects: THREE.Object3D[] = [intact.mesh];
      if (cut === primaryCut) {
        // The signature "signal": a faint halo and a light that runs along the cable under watch.
        const halo = new THREE.Mesh(
          new THREE.TubeGeometry(intact.curve, Math.max(12, run.length * 2), SIGNAL_HALO_RADIUS_KM, 8, false),
          thinTubeWithDistance(new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.cable, transparent: true, opacity: 0.12, depthWrite: false }), SIGNAL_HALO_RADIUS_KM),
        );
        scene.add(halo);
        intactObjects.push(halo);
        signalCurve = intact.curve;
        signalStopCurve = before.curve;
        const previous = run[Math.max(0, nearest.index - 2)];
        const next = run[Math.min(run.length - 1, nearest.index + 2)];
        if (previous && next) cableDirection = unitDirection(previous, next, cableDirection);
      }
      cutSwitches.push({ cut, intact: intactObjects, pieces: [before.mesh, after.mesh] });
    }
  }

  // Each pipeline is named once, where it runs farthest from the track and the cuts, so labels do not pile up.
  const busyPoints = [...densifyScenePoints(input.track.map((position) => toScene(position.longitude, position.latitude)), LABEL_BUSY_STEP_KM), ...input.cuts.map((cut) => toScene(cut.longitude, cut.latitude))];
  for (const [name, curves] of pipelineCurves) {
    const labelPoint = findQuietLabelPoint(curves, busyPoints);
    if (!labelPoint) continue;
    const label = makeLabel(name, "pipeline");
    label.position.set(labelPoint.x, labelPoint.y + 0.9, labelPoint.z);
    scene.add(label);
  }

  for (const place of features.places) {
    const point = toScene(place.longitude, place.latitude);
    const label = makeLabel(place.name, "land");
    label.position.set(point.x, sampleSeabedHeight(point.x, point.z) + 0.8, point.z);
    scene.add(label);
  }

  const signalCore = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: SCENE_COLORS.signalCore }));
  const signalGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDot, color: SCENE_COLORS.signalGlow, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  signalGlow.scale.setScalar(1.6);
  const signal = new THREE.Group();
  signal.add(signalCore, signalGlow);
  signal.visible = signalCurve !== null;
  scene.add(signal);

  // The reconstructed track: straight segments between published positions, drawn as time passes.
  const trackScene = input.track.map((position) => ({ atMs: position.atMs, ...toScene(position.longitude, position.latitude) }));
  const cumulativeKm = trackScene.reduce<number[]>((sums, point, index) => {
    const previous = trackScene[index - 1];
    const previousSum = sums[index - 1] ?? 0;
    sums.push(previous ? previousSum + Math.hypot(point.x - previous.x, point.z - previous.z) : 0);
    return sums;
  }, []);
  const totalTrackKm = cumulativeKm[cumulativeKm.length - 1] ?? 0;
  let pastTrack: ProgressLine | null = null;
  if (trackScene.length >= 2 && totalTrackKm > 0) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let index = 1; index < trackScene.length; index += 1) {
      const start = trackScene[index - 1];
      const end = trackScene[index];
      if (start && end) path.add(new THREE.LineCurve3(new THREE.Vector3(start.x, TRACK_SURFACE_LIFT, start.z), new THREE.Vector3(end.x, TRACK_SURFACE_LIFT, end.z)));
    }
    // Evenly spaced by distance; each point takes the alarm color while the anchor drags at that moment.
    const trackColors = Array.from({ length: TRACK_SEGMENTS + 1 }, (_slot, index) => {
      const atMs = timeAtTrackKm((totalTrackKm * index) / TRACK_SEGMENTS);
      const isDragging = input.dragWindow !== null && atMs >= input.dragWindow.startMs && atMs <= input.dragWindow.endMs;
      return isDragging ? WEBGL_COLORS.alarm : WEBGL_COLORS.ink;
    });
    pastTrack = createProgressLine({ points: path.getSpacedPoints(TRACK_SEGMENTS), color: trackColors, widthPx: TRACK_WIDTH_PX });
    scene.add(pastTrack.line);
  }

  /** The moment the vessel had sailed `km` along the track (the inverse of trackKmAt). */
  function timeAtTrackKm(km: number): number {
    for (let index = 1; index < trackScene.length; index += 1) {
      const previous = trackScene[index - 1];
      const next = trackScene[index];
      const startKm = cumulativeKm[index - 1] ?? 0;
      const endKm = cumulativeKm[index] ?? 0;
      if (!previous || !next || km > endKm) continue;
      const amount = endKm > startKm ? (km - startKm) / (endKm - startKm) : 0;
      return previous.atMs + (next.atMs - previous.atMs) * amount;
    }
    return trackScene[trackScene.length - 1]?.atMs ?? 0;
  }

  function trackKmAt(atMs: number): number {
    for (let index = 1; index < trackScene.length; index += 1) {
      const previous = trackScene[index - 1];
      const next = trackScene[index];
      if (!previous || !next || atMs > next.atMs) continue;
      if (atMs <= previous.atMs) return cumulativeKm[index - 1] ?? 0;
      const span = next.atMs - previous.atMs;
      const amount = span <= 0 ? 1 : (atMs - previous.atMs) / span;
      return (cumulativeKm[index - 1] ?? 0) + ((cumulativeKm[index] ?? 0) - (cumulativeKm[index - 1] ?? 0)) * amount;
    }
    return atMs < (trackScene[0]?.atMs ?? 0) ? 0 : totalTrackKm;
  }

  function sceneAt(atMs: number): ScenePoint | null {
    const position = positionAtTime(input.track, atMs);
    return position ? toScene(position.longitude, position.latitude) : null;
  }

  // The anchor's furrow along the track, from the start to the end of the drag window.
  const dragWindow = input.dragWindow;
  let furrow: ProgressLine | null = null;
  if (dragWindow && dragWindow.endMs > dragWindow.startMs) {
    const furrowPoints = Array.from({ length: FURROW_SEGMENTS + 1 }, (_slot, index) => sceneAt(dragWindow.startMs + ((dragWindow.endMs - dragWindow.startMs) * index) / FURROW_SEGMENTS))
      .filter((point): point is ScenePoint => point !== null)
      .map((point) => new THREE.Vector3(point.x, sampleSeabedHeight(point.x, point.z) + FURROW_SEABED_LIFT, point.z));
    if (furrowPoints.length >= 2) {
      furrow = createProgressLine({ points: furrowPoints, color: WEBGL_COLORS.alarm, widthPx: FURROW_WIDTH_PX });
      scene.add(furrow.line);
    }
  }

  const tanker = buildTankerModel();
  const ship = tanker.group;
  ship.scale.setScalar(SHIP_DRAWN_SCALE * METRES_TO_KM);
  const shipLabel = makeStackedLabel(input.vessel.name, input.vessel.note, "above");
  shipLabel.position.set(0, SHIP_LABEL_HEIGHT_METRES, 0);
  ship.add(shipLabel);
  ship.visible = false;
  scene.add(ship);
  const wake = createWake();
  scene.add(wake.mesh);
  const anchorModel = buildAnchorModel(new THREE.MeshStandardMaterial({ color: SCENE_COLORS.anchor, roughness: 0.48, metalness: 0.6 }));
  const anchor = anchorModel.group;
  anchor.scale.setScalar(ANCHOR_DRAWN_SCALE * METRES_TO_KM);
  anchor.visible = false;
  scene.add(anchor);
  const chainGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const chain = new THREE.Line(chainGeometry, new THREE.LineBasicMaterial({ color: SCENE_COLORS.anchor, transparent: true, opacity: 0.85 }));
  chain.frustumCulled = false;
  chain.visible = false;
  scene.add(chain);

  const cutMarkers = input.cuts.map((cut) => {
    const point = toScene(cut.longitude, cut.latitude);
    const seabedY = sampleSeabedHeight(point.x, point.z) + 0.2;
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 10, 48), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm }));
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm, transparent: true, opacity: 0.7 }));
    beam.scale.y = -seabedY + 1.2;
    beam.position.y = (1.2 - seabedY) / 2;
    marker.add(ring, beam);
    marker.position.set(point.x, seabedY, point.z);
    marker.visible = false;
    // Cut labels hang below their point and the vessel's label sits above the vessel, so the two never
    // cover each other when the vessel passes a cut.
    const nameLabel = makeLabel(cut.label, "cable", "below");
    const cutLabel = makeLabel(`${cut.label} cut`, "alarm", "below");
    nameLabel.position.set(point.x, 1.6, point.z);
    cutLabel.position.copy(nameLabel.position);
    scene.add(marker, nameLabel, cutLabel);
    return { cut, marker, nameLabel, cutLabel };
  });

  const plumePositions = new Float32Array(PLUME_PARTICLE_COUNT * 3);
  const plumeAges = new Float32Array(PLUME_PARTICLE_COUNT).fill(2);
  const plumeDrift = Array.from({ length: PLUME_PARTICLE_COUNT }, () => new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5));
  const plumeGeometry = new THREE.BufferGeometry();
  plumeGeometry.setAttribute("position", new THREE.BufferAttribute(plumePositions, 3));
  const plume = new THREE.Points(
    plumeGeometry,
    new THREE.PointsMaterial({ map: softDot, color: SCENE_COLORS.plume, size: 0.55, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }),
  );
  plume.frustumCulled = false;
  scene.add(plume);

  const halfFovTangent = Math.tan(((OVERVIEW_FOV_DEGREES / 2) * Math.PI) / 180);
  const topHeightKm = Math.max(projection.depthKm, projection.widthKm / TOP_VIEW_ASPECT) / (2 * halfFovTangent) + 4;
  const camera = new THREE.PerspectiveCamera(OVERVIEW_FOV_DEGREES, 1, 0.1, topHeightKm * 4);
  const controls = new OrbitControls(camera, options.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = topHeightKm * 1.4;
  controls.maxPolarAngle = Math.PI * 0.46;
  // The overview frames the whole track (the story at a glance); without one it frames the block.
  const trackBounds = new THREE.Box3();
  trackScene.forEach((point) => trackBounds.expandByPoint(new THREE.Vector3(point.x, OVERVIEW_TARGET_Y, point.z)));
  const focusTarget = trackScene.length >= 2 ? trackBounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, OVERVIEW_TARGET_Y, 0);
  const focusRadiusKm = trackScene.length >= 2 ? Math.max(OVERVIEW_MIN_RADIUS_KM, trackBounds.getSize(new THREE.Vector3()).length() / 2 + OVERVIEW_PADDING_KM) : blockRadiusKm;
  const presets: OverviewScene["presets"] = {
    overview: { position: focusTarget.clone().addScaledVector(OVERVIEW_DIRECTION, (focusRadiusKm / halfFovTangent) * 0.9), target: focusTarget.clone() },
    // Straight down with north up: the camera sits a hair to the south so its azimuth is zero.
    top: { position: new THREE.Vector3(0, topHeightKm, 0.01), target: new THREE.Vector3(0, OVERVIEW_TARGET_Y, 0) },
  };

  const trackBefore = sceneAt(primaryCut.atMs - HEADING_SPAN_MS);
  const trackAfter = sceneAt(primaryCut.atMs + HEADING_SPAN_MS);
  const trackDirection = trackBefore && trackAfter ? unitDirection(trackBefore, trackAfter, { x: 1, z: 0 }) : { x: 1, z: 0 };

  let lastAtMs = Number.NEGATIVE_INFINITY;
  let vesselFrame: VesselFrame | null = null;
  let lastHeading: ScenePoint = { x: 1, z: 0 };
  // Reused every frame instead of allocating.
  const sternWorld = new THREE.Vector3();
  const hawseWorld = new THREE.Vector3();
  const shackleWorld = new THREE.Vector3();
  const wakeTrail: ScenePoint[] = [];

  function update(atMs: number, deltaSeconds: number, nowSeconds: number) {
    const shipPoint = sceneAt(atMs);
    ship.visible = shipPoint !== null;
    if (shipPoint) {
      ship.position.set(shipPoint.x, 0, shipPoint.z);
      const before = sceneAt(atMs - HEADING_SPAN_MS) ?? shipPoint;
      const after = sceneAt(atMs + HEADING_SPAN_MS) ?? shipPoint;
      const heading = unitDirection(before, after, { x: 0, z: 0 });
      if (heading.x !== 0 || heading.z !== 0) lastHeading = heading;
      ship.rotation.y = Math.atan2(-lastHeading.z, lastHeading.x);
      ship.updateMatrixWorld();
      vesselFrame = { position: ship.position, heading: lastHeading };
      // The wake: the stern now, then the path sailed over the last minutes.
      sternWorld.copy(tanker.sternLocal).applyMatrix4(ship.matrixWorld);
      const sternOffsetKm = sternWorld.distanceTo(ship.position);
      wakeTrail.length = 0;
      wakeTrail.push({ x: sternWorld.x, z: sternWorld.z });
      for (let sample = 1; sample <= WAKE_SAMPLE_COUNT; sample += 1) {
        const past = sceneAt(atMs - sample * WAKE_STEP_MS);
        if (!past) break;
        wakeTrail.push({ x: past.x - lastHeading.x * sternOffsetKm, z: past.z - lastHeading.z * sternOffsetKm });
      }
      wake.update(wakeTrail, WAKE_HALF_WIDTH_KM);
    } else {
      vesselFrame = null;
      wake.mesh.visible = false;
    }
    if (pastTrack) pastTrack.setFraction(totalTrackKm > 0 ? trackKmAt(atMs) / totalTrackKm : 0);

    const isDragging = dragWindow !== null && shipPoint !== null && atMs >= dragWindow.startMs && atMs <= dragWindow.endMs;
    if (furrow && dragWindow) furrow.setFraction((atMs - dragWindow.startMs) / (dragWindow.endMs - dragWindow.startMs));
    anchor.visible = isDragging;
    chain.visible = isDragging;
    if (isDragging && shipPoint) {
      // The anchor drags on the seabed under the vessel, shank pointing up the chain toward the bow.
      anchor.position.set(shipPoint.x, sampleSeabedHeight(shipPoint.x, shipPoint.z) + 0.02, shipPoint.z);
      anchor.rotation.set(-0.12, Math.atan2(lastHeading.x, lastHeading.z), 0);
      anchor.updateMatrixWorld();
      hawseWorld.copy(tanker.hawseLocal).applyMatrix4(ship.matrixWorld);
      shackleWorld.copy(anchorModel.shackleLocal).applyMatrix4(anchor.matrixWorld);
      const chainPositions = chainGeometry.getAttribute("position");
      chainPositions.setXYZ(0, hawseWorld.x, hawseWorld.y, hawseWorld.z);
      chainPositions.setXYZ(1, shackleWorld.x, shackleWorld.y, shackleWorld.z);
      chainPositions.needsUpdate = true;
    }

    for (const cutSwitch of cutSwitches) {
      const isCut = atMs >= cutSwitch.cut.atMs;
      cutSwitch.intact.forEach((object) => {
        object.visible = !isCut;
      });
      cutSwitch.pieces.forEach((object) => {
        object.visible = isCut;
      });
    }
    for (const cutMarker of cutMarkers) {
      const isCut = atMs >= cutMarker.cut.atMs;
      cutMarker.marker.visible = isCut;
      cutMarker.cutLabel.visible = isCut;
      cutMarker.nameLabel.visible = !isCut;
    }

    const isPrimaryCut = atMs >= primaryCut.atMs;
    if (signalCurve) {
      if (isPrimaryCut && signalStopCurve) {
        signal.position.copy(signalStopCurve.getPointAt(1));
        const pulse = prefersReducedMotion ? 1 : 0.75 + 0.35 * Math.sin(nowSeconds * 6);
        signalGlow.scale.setScalar(1.6 * pulse);
        signalGlow.material.color.set(SCENE_COLORS.cutGlow);
        signalCore.material.color.set(SCENE_COLORS.cutCore);
      } else {
        signal.position.copy(signalCurve.getPointAt(prefersReducedMotion ? 0.3 : (nowSeconds / SIGNAL_LAP_SECONDS) % 1));
        signalGlow.scale.setScalar(1.6);
        signalGlow.material.color.set(SCENE_COLORS.signalGlow);
        signalCore.material.color.set(SCENE_COLORS.signalCore);
      }
    }

    // Sediment rises behind the anchor while it drags; scrubbing backwards clears it.
    if (atMs < lastAtMs) plumeAges.fill(2);
    lastAtMs = atMs;
    if (isDragging && deltaSeconds > 0) {
      for (let index = 0; index < PLUME_PARTICLE_COUNT; index += 1) {
        if ((plumeAges[index] ?? 2) >= 1 && Math.random() < 0.18) {
          plumeAges[index] = 0;
          plumePositions[index * 3] = anchor.position.x + (Math.random() - 0.5) * 0.4;
          plumePositions[index * 3 + 1] = anchor.position.y;
          plumePositions[index * 3 + 2] = anchor.position.z + (Math.random() - 0.5) * 0.4;
        }
      }
    }
    for (let index = 0; index < PLUME_PARTICLE_COUNT; index += 1) {
      const age = plumeAges[index] ?? 2;
      const drift = plumeDrift[index];
      if (age >= 1 || !drift) {
        plumePositions[index * 3 + 1] = -999;
        continue;
      }
      plumeAges[index] = age + deltaSeconds * 0.6;
      plumePositions[index * 3] = (plumePositions[index * 3] ?? 0) + drift.x * deltaSeconds;
      plumePositions[index * 3 + 1] = (plumePositions[index * 3 + 1] ?? 0) + drift.y * deltaSeconds;
      plumePositions[index * 3 + 2] = (plumePositions[index * 3 + 2] ?? 0) + drift.z * deltaSeconds;
    }
    plumeGeometry.getAttribute("position").needsUpdate = true;
  }

  return { scene, camera, controls, presets, primaryCutScene, trackDirection, cableDirection, readVesselFrame: () => vesselFrame, update };
}
