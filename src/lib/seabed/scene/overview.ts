import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { describeVesselPosition, positionAtTime, type ReplayCut, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import { makeLabel, makePointMarker, makeStackedLabel } from "@/lib/seabed/scene/labels";
import { buildAnchorModel } from "@/lib/seabed/scene/models";
import { createProgressLine, type ProgressLine } from "@/lib/seabed/scene/progress-line";
import { DEPTH_TOKEN_RAMP, LAND_TOKEN_RAMP, SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { bakeReliefOcclusion } from "@/lib/seabed/scene/relief-occlusion";
import { createTerrainMaterial, measureLevelIrradiance, type TerrainLighting } from "@/lib/seabed/scene/terrain-material";
import { buildWaterBody } from "@/lib/seabed/scene/water-surface";
import { FULL_WIDTH_DISTANCE_KM, readThinnedTubeMiddle, thinTubeWithDistance } from "@/lib/seabed/scene/tube-thinning";
import { createWake } from "@/lib/seabed/scene/wake";
import type { SeabedFeatures } from "@/lib/seabed/seabed-data";
import { buildShip } from "@/lib/ships/build-ship";
import { estimateCaseShipChain, readChainSpan, shapeCatenary, type ChainShape } from "@/lib/ships/anchor-chain";
import { createKelvinWake } from "@/lib/ships/kelvin-wake";
import { chooseSceneExaggeration, SCENE_SCALES, type SceneExaggeration } from "@/lib/seabed/scene-scales";
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
// The radii above are tuned for the 145 km wide Gulf of Finland block. A wider block draws its tubes wider in
// step, so they keep their share of the screen in the overview instead of breaking into sub-pixel dashes.
const REFERENCE_BLOCK_WIDTH_KM = 145;
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
// The anchor chain: points along its drawn catenary, its on-screen width, and the points of the close-up's chain.
const CHAIN_POINT_COUNT = 48;
const CHAIN_WIDTH_PX = 1.5;
const CLOSE_UP_CHAIN_POINT_COUNT = 240;
const PLUME_PARTICLE_COUNT = 140;
// Heading is read over this span around the current moment, so a reconstructed corner does not snap the hull.
const HEADING_SPAN_MS = 2 * 60 * 1000;
// The light along the healthy cable takes this long to run its length.
const SIGNAL_LAP_SECONDS = 7;
// Lookdev colour probes: shares along each data tube, how many points of each track tone are probed, and points
// around each cut marker's ring (radius in km, the ring's own).
const COLOR_PROBE_SHARES = [0.1, 0.3, 0.5, 0.7, 0.9];
const TRACK_PROBES_PER_TONE = 16;
const CUT_RING_RADIUS_KM = 0.75;
const CUT_RING_PROBE_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
// Model metres to scene kilometres. The vessel is drawn 6 times its real size and the anchor 30 times, so
// both read across a block 145 to 300 km wide; the disclosure under the view says so.
const METRES_TO_KM = 1 / 1000;
const SHIP_DRAWN_SCALE = SCENE_SCALES.shipDrawnScale;
const ANCHOR_DRAWN_SCALE = SCENE_SCALES.anchorDrawnScale;
// The vessel's label floats this many ship lengths above its waterline, clear of the bridge and masts.
const SHIP_LABEL_HEIGHT_LENGTHS = 0.24;
// The wake follows the last 13 minutes of the path, sampled every 20 s.
const WAKE_STEP_MS = 20 * 1000;
const WAKE_SAMPLE_COUNT = 40;
// The overview camera looks from the south-east, down about 35 degrees (the approved prototype angle).
const OVERVIEW_DIRECTION = new THREE.Vector3(14, 19, 26).normalize();
const OVERVIEW_TARGET_Y = -1.8;
const SUN_SHADOW_SOFTNESS_TEXELS = 4;
// The ship's contact shadow: a soft ellipse a little longer and wider than the hull, just over the water (model metres).
const CONTACT_SHADOW_LENGTH_SHARE = 1.2;
const CONTACT_SHADOW_BEAM_SHARE = 2.4;
const CONTACT_SHADOW_OPACITY = 0.2;
const CONTACT_SHADOW_LIFT_METRES = 0.3;
// Room kept around the track when the overview frames it (km), and the smallest framed radius.
const OVERVIEW_PADDING_KM = 6;
const OVERVIEW_MIN_RADIUS_KM = 12;
// Vertical field of view of the overview camera (degrees); the viewer widens it on narrow screens.
export const OVERVIEW_FOV_DEGREES = 32;
// The top view fits the block for this aspect ratio, a little wider than the replay card.
const TOP_VIEW_ASPECT = 1.6;

/** Where the vessel is, which way it heads and how long it is drawn (km), for the camera that follows it. */
export type VesselFrame = { position: THREE.Vector3; heading: ScenePoint; drawnLengthKm: number };

export type OverviewViewName = "overview" | "top";

/**
 * An object in the overview a card can open on: the vessel, one of the case's cuts, or one of the positions placed
 * from statements, each by its index in the case.
 */
export type SceneTarget = { kind: "vessel" } | { kind: "cut"; cutIndex: number } | { kind: "placement"; positionIndex: number };

/** A target a click can select, where it is drawn, and the label naming it (a click on the label selects it too). */
export type ScenePickable = { target: SceneTarget; position: THREE.Vector3; label: HTMLElement };

/** The data colours a frame must show exactly (docs/UI_DESIGN_SYSTEM.md, Data): `suspect` is the vessel's ink track. */
export type DataTone = "cable" | "pipeline" | "suspect" | "alarm";

/** A point in the scene where a data line of one tone is drawn on the current frame (scripts/lookdev samples it). */
export type ColorProbe = { tone: DataTone; position: THREE.Vector3 };

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
  /** The anchor chain's shape when the primary cut happened (metres), or null where the model has none. */
  primaryCutChain: ChainShape | null;
  /** The vessel's last drawn frame, or null while it is not on the map yet. */
  readVesselFrame: () => VesselFrame | null;
  /**
   * Where a target sits in the scene and the label naming it now, or null while it is not drawn (the vessel before
   * its first position).
   */
  locateTarget: (target: SceneTarget) => { position: THREE.Vector3; label: HTMLElement } | null;
  /**
   * What a click can select at the last drawn moment: the vessel once it is on the map, each cut once it has
   * happened, and every placed position.
   */
  readPickables: () => ScenePickable[];
  /** Hides the land and pipeline names on a narrow view, keeping the vessel and cut labels. */
  setCompactLabels: (isCompact: boolean) => void;
  update: (atMs: number, deltaSeconds: number, nowSeconds: number) => void;
  /** Points on the data lines drawn at the last updated moment, seen from `cameraPosition`, for the lookdev colour check. */
  readColorProbes: (cameraPosition: THREE.Vector3) => ColorProbe[];
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
  /** The GPU tier: finer detail (hull plating relief, waves, ripples) that a CPU renderer would pay for every frame. */
  isHighDetail: boolean;
  /** The sand-ripple detail normal map (GPU tier), or null. */
  rippleNormalMap: THREE.Texture | null;
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

// The sand-ripple detail repeats every this many km of seabed: drawn about 120 m across so it reads in the Vessel view
// (illustrative texture, not survey data; mipmaps fade it to nothing in the overview).
const RIPPLE_TILE_KM = 0.12;

type TerrainLook = { lighting: TerrainLighting; rippleNormalMap: THREE.Texture | null };

function buildTerrainMesh(elevations: Float32Array, features: SeabedFeatures, projection: Projection, exaggeration: SceneExaggeration, look: TerrainLook): THREE.Mesh {
  const { lighting, rippleNormalMap } = look;
  const { width: columns, height: rows } = features.grid;
  const geometry = new THREE.PlaneGeometry(projection.widthKm, projection.depthKm, columns - 1, rows - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const sceneHeights = new Float32Array(positions.count);
  const depthRamp = buildRamp(DEPTH_TOKEN_RAMP);
  const landRamp = buildRamp(LAND_TOKEN_RAMP);
  const vertexColor = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const elevation = elevations[index] ?? 0;
    const sceneY = elevationToSceneY(elevation, exaggeration);
    positions.setY(index, sceneY);
    sceneHeights[index] = sceneY;
    if (elevation < 0) sampleRamp(depthRamp, -elevation, vertexColor);
    else sampleRamp(landRamp, elevation, vertexColor);
    vertexColor.toArray(colors, index * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("elevation", new THREE.BufferAttribute(elevations, 1));
  geometry.setAttribute("reliefOcclusion", new THREE.BufferAttribute(bakeReliefOcclusion(sceneHeights, columns, rows, projection.widthKm / (columns - 1), projection.depthKm / (rows - 1)), 1));
  geometry.computeVertexNormals();
  if (rippleNormalMap) rippleNormalMap.repeat.set(projection.widthKm / RIPPLE_TILE_KM, projection.depthKm / RIPPLE_TILE_KM);
  const mesh = new THREE.Mesh(geometry, createTerrainMaterial(lighting, rippleNormalMap));
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
  // Deep areas are drawn less exaggerated than the shallow Baltic (scene-scales.ts); the page states the same factors.
  const exaggeration = chooseSceneExaggeration(features.elevationRange);
  const sampleSeabedHeight = (sceneX: number, sceneZ: number) => elevationToSceneY(sampleElevationMetres(sceneX, sceneZ), exaggeration);
  const deepestElevation = elevations.reduce((deepest, elevation) => Math.min(deepest, elevation), 0);
  const deepestY = elevationToSceneY(deepestElevation, exaggeration);
  const baseY = deepestY - BLOCK_BASE_THICKNESS_KM;
  const toScene = (longitude: number, latitude: number) => projection.toScene(longitude, latitude);

  const scene = new THREE.Scene();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  environmentGenerator.dispose();
  scene.environmentIntensity = 0.38;
  const skyLight = new THREE.HemisphereLight(SCENE_COLORS.skyLight, SCENE_COLORS.groundLight, 0.95);
  scene.add(skyLight);
  const sunLight = new THREE.DirectionalLight(SCENE_COLORS.skyLight, 2.1);
  const blockRadiusKm = Math.hypot(projection.widthKm, projection.depthKm) / 2;
  sunLight.position.set(-42, 78, -26).setLength(blockRadiusKm * 1.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -blockRadiusKm, right: blockRadiusKm, top: blockRadiusKm, bottom: -blockRadiusKm, near: 1, far: blockRadiusKm * 3.2 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.04;
  // Soft sun shadows: three.js r186's PCF filter blurs over this many shadow-map texels.
  sunLight.shadow.radius = SUN_SHADOW_SOFTNESS_TEXELS;
  scene.add(sunLight);

  const terrain = buildTerrainMesh(elevations, features, projection, exaggeration, { lighting: { levelIrradiance: measureLevelIrradiance(sunLight, skyLight) }, rippleNormalMap: options.rippleNormalMap });
  const water = buildWaterBody(projection, deepestY, options.isHighDetail);
  scene.add(terrain, buildBlockSides(terrain, features, baseY), water.group);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(blockRadiusKm * 6, blockRadiusKm * 6), new THREE.ShadowMaterial({ opacity: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = baseY - 0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const tubeScale = Math.max(1, projection.widthKm / REFERENCE_BLOCK_WIDTH_KM);
  const tubeRadii = {
    power: POWER_CABLE_RADIUS_KM * tubeScale,
    telecom: TELECOM_CABLE_RADIUS_KM * tubeScale,
    pipeline: PIPELINE_RADIUS_KM * tubeScale,
    signalHalo: SIGNAL_HALO_RADIUS_KM * tubeScale,
  };
  const fullWidthDistanceKm = FULL_WIDTH_DISTANCE_KM * tubeScale;
  // One material per tube radius: each narrows with camera distance from its own radius (tube-thinning.ts).
  const createCableMaterial = (radiusKm: number) =>
    thinTubeWithDistance(
      new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.cable, emissive: WEBGL_COLORS.cable, emissiveIntensity: 0.28, roughness: 0.38, metalness: 0.1 }),
      radiusKm,
      fullWidthDistanceKm,
    );
  const cableMaterials = { power: createCableMaterial(tubeRadii.power), telecom: createCableMaterial(tubeRadii.telecom) };
  const pipelineMaterial = thinTubeWithDistance(
    new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.pipeline, emissive: WEBGL_COLORS.pipeline, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.1 }),
    tubeRadii.pipeline,
    fullWidthDistanceKm,
  );

  const primaryCut = input.cuts[0];
  const primaryCutScene = toScene(primaryCut.longitude, primaryCut.latitude);
  let cableDirection: ScenePoint = { x: 1, z: 0 };
  let signalCurve: THREE.CatmullRomCurve3 | null = null;
  let signalStopCurve: THREE.CatmullRomCurve3 | null = null;
  // Each cut cable swaps its intact tube for two pieces once its cut time has passed.
  const cutSwitches: { cut: ReplayCut; intact: THREE.Object3D[]; pieces: THREE.Object3D[] }[] = [];
  const pipelineCurves = new Map<string, THREE.CatmullRomCurve3[]>();
  // Every data tube, for the lookdev colour probes.
  const dataTubes: { tone: DataTone; radius: number; tube: ReturnType<typeof createSeabedTube> }[] = [];

  for (const line of features.lines) {
    const scenePoints = densifyScenePoints(line.points.map(([longitude, latitude]) => toScene(longitude, latitude)), LINE_STEP_KM);
    for (const run of clipToBlock(scenePoints, projection)) {
      if (line.kind === "pipeline") {
        const pipeline = createSeabedTube(run, tubeRadii.pipeline, pipelineMaterial, sampleSeabedHeight);
        scene.add(pipeline.mesh);
        dataTubes.push({ tone: "pipeline", radius: tubeRadii.pipeline, tube: pipeline });
        pipelineCurves.set(line.name, [...(pipelineCurves.get(line.name) ?? []), pipeline.curve]);
        continue;
      }
      const radius = tubeRadii[line.kind];
      const cableMaterial = cableMaterials[line.kind];
      const intact = createSeabedTube(run, radius, cableMaterial, sampleSeabedHeight);
      scene.add(intact.mesh);
      dataTubes.push({ tone: "cable", radius, tube: intact });
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
      dataTubes.push({ tone: "cable", radius, tube: before }, { tone: "cable", radius, tube: after });
      const intactObjects: THREE.Object3D[] = [intact.mesh];
      if (cut === primaryCut) {
        // The signature "signal": a faint halo and a light that runs along the cable under watch.
        const halo = new THREE.Mesh(
          new THREE.TubeGeometry(intact.curve, Math.max(12, run.length * 2), tubeRadii.signalHalo, 8, false),
          thinTubeWithDistance(
            new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.cable, transparent: true, opacity: 0.12, depthWrite: false }),
            tubeRadii.signalHalo,
            fullWidthDistanceKm,
          ),
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

  // Names that give context but carry no case data; a narrow view drops them first (setCompactLabels).
  const contextLabels: THREE.Object3D[] = [];
  // Each pipeline is named once, where it runs farthest from the track, the cuts, the place names and the names
  // already placed, so labels do not pile up (Nord Stream 1 and 2 run side by side; Balticconnector lands at Inkoo).
  const busyPoints = [
    ...densifyScenePoints(input.track.map((position) => toScene(position.longitude, position.latitude)), LABEL_BUSY_STEP_KM),
    ...input.cuts.map((cut) => toScene(cut.longitude, cut.latitude)),
    ...features.places.map((place) => toScene(place.longitude, place.latitude)),
  ];
  for (const [name, curves] of pipelineCurves) {
    const labelPoint = findQuietLabelPoint(curves, busyPoints);
    if (!labelPoint) continue;
    const label = makeLabel(name, "pipeline");
    label.position.set(labelPoint.x, labelPoint.y + 0.9, labelPoint.z);
    scene.add(label);
    contextLabels.push(label);
    busyPoints.push({ x: labelPoint.x, z: labelPoint.z });
  }

  for (const place of features.places) {
    const point = toScene(place.longitude, place.latitude);
    const label = makeLabel(place.name, "land");
    label.position.set(point.x, sampleSeabedHeight(point.x, point.z) + 0.8, point.z);
    scene.add(label);
    contextLabels.push(label);
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

  // The track: straight segments between placed positions and recorded AIS fixes, drawn as time passes.
  const trackScene = input.track.map((position) => ({ atMs: position.atMs, ...toScene(position.longitude, position.latitude) }));
  const cumulativeKm = trackScene.reduce<number[]>((sums, point, index) => {
    const previous = trackScene[index - 1];
    const previousSum = sums[index - 1] ?? 0;
    sums.push(previous ? previousSum + Math.hypot(point.x - previous.x, point.z - previous.z) : 0);
    return sums;
  }, []);
  const totalTrackKm = cumulativeKm[cumulativeKm.length - 1] ?? 0;
  let pastTrack: ProgressLine | null = null;
  // The drawn track's points and their tones, for the lookdev colour probes.
  let trackProbePoints: { position: THREE.Vector3; tone: DataTone; atMs: number }[] = [];
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
    const trackPoints = path.getSpacedPoints(TRACK_SEGMENTS);
    pastTrack = createProgressLine({ points: trackPoints, color: trackColors, widthPx: TRACK_WIDTH_PX });
    scene.add(pastTrack.line);
    trackProbePoints = trackPoints.map((position, index) => ({
      position,
      tone: trackColors[index] === WEBGL_COLORS.alarm ? "alarm" : "suspect",
      atMs: timeAtTrackKm((totalTrackKm * index) / TRACK_SEGMENTS),
    }));
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

  const dragWindow = input.dragWindow;

  // Built at the case ship's real length, then drawn at the scale the disclosure under the view states.
  const shipModel = buildShip({ kind: input.vessel.kind, lengthMetres: input.vessel.lengthMetres, tone: "suspect", isDetailed: options.isHighDetail });
  const ship = shipModel.group;
  ship.scale.setScalar(SHIP_DRAWN_SCALE * METRES_TO_KM);
  const shipDrawnLengthKm = input.vessel.lengthMetres * SHIP_DRAWN_SCALE * METRES_TO_KM;
  // The foam trail starts as wide as the drawn hull.
  const wakeHalfWidthKm = shipModel.form.halfBeam * SHIP_DRAWN_SCALE * METRES_TO_KM;
  const shipLabel = makeStackedLabel(input.vessel.name, describeVesselPosition(input.track, input.windowStartMs), "above");
  shipLabel.object.position.set(0, SHIP_LABEL_HEIGHT_LENGTHS * input.vessel.lengthMetres, 0);
  ship.add(shipLabel.object);
  ship.visible = false;
  scene.add(ship);
  // A soft contact shadow on the water around the hull (ambient occlusion where hull meets sea), so the ship sits in
  // the water instead of hovering over a sea that is mostly transparent from above.
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(input.vessel.lengthMetres * CONTACT_SHADOW_LENGTH_SHARE, shipModel.form.halfBeam * 2 * CONTACT_SHADOW_BEAM_SHARE),
    new THREE.MeshBasicMaterial({ map: softDot, color: SCENE_COLORS.contactShadow, transparent: true, opacity: CONTACT_SHADOW_OPACITY, depthWrite: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = CONTACT_SHADOW_LIFT_METRES;
  contactShadow.renderOrder = 2.6;
  ship.add(contactShadow);
  // The GPU tier draws the bow wave and the Kelvin wake on a patch that sails with the hull.
  const kelvinWake = options.isHighDetail ? createKelvinWake(shipModel.form) : null;
  if (kelvinWake) ship.add(kelvinWake.mesh);
  const wake = createWake();
  scene.add(wake.mesh);
  const anchorModel = buildAnchorModel(new THREE.MeshStandardMaterial({ color: SCENE_COLORS.anchor, roughness: 0.48, metalness: 0.6 }));
  const anchor = anchorModel.group;
  anchor.scale.setScalar(ANCHOR_DRAWN_SCALE * METRES_TO_KM);
  anchor.visible = false;
  scene.add(anchor);
  const chainGeometry = new LineGeometry();
  chainGeometry.setPositions(new Float32Array(CHAIN_POINT_COUNT * 3));
  const chain = new Line2(chainGeometry, new LineMaterial({ color: SCENE_COLORS.anchor, linewidth: CHAIN_WIDTH_PX, worldUnits: false }));
  chain.frustumCulled = false;
  chain.visible = false;
  scene.add(chain);

  // The anchor from physics (src/lib/ships/anchor-chain.ts, the detector's own model): the case ship's chain hangs
  // from the hawse as a catenary for the depth under it and lies on the ground behind, so the anchor trails the
  // hawse by the layback along the ground the ship has just covered, as the detector reconstructs it.
  const chainState = estimateCaseShipChain(input.vessel.kind, input.vessel.lengthMetres);
  // The real hawse is this far ahead of the track point (the hull's midpoint), in km.
  const hawseAheadKm = shipModel.hawseLocal.x * METRES_TO_KM;
  /** Where the anchor lies at a moment and the chain's span there, or null before the first position or in water too deep for the chain. */
  function locateAnchor(atMs: number): { point: ScenePoint; span: { laybackMetres: number; heightMetres: number } } | null {
    const shipPoint = sceneAt(atMs);
    if (!shipPoint) return null;
    const span = readChainSpan(chainState, sampleElevationMetres(shipPoint.x, shipPoint.z));
    if (!span) return null;
    // Behind the first position the ground was never covered: the anchor holds at the track's start.
    const anchorKm = Math.max(0, trackKmAt(atMs) + hawseAheadKm - span.laybackMetres * METRES_TO_KM);
    const point = sceneAt(timeAtTrackKm(anchorKm));
    return point ? { point, span } : null;
  }

  // The anchor's furrow: where the anchor itself went, from the start to the end of the drag window.
  let furrow: ProgressLine | null = null;
  if (dragWindow && dragWindow.endMs > dragWindow.startMs) {
    const furrowPoints = Array.from({ length: FURROW_SEGMENTS + 1 }, (_slot, index) => locateAnchor(dragWindow.startMs + ((dragWindow.endMs - dragWindow.startMs) * index) / FURROW_SEGMENTS))
      .flatMap((located) => (located ? [located.point] : []))
      .map((point) => new THREE.Vector3(point.x, sampleSeabedHeight(point.x, point.z) + FURROW_SEABED_LIFT, point.z));
    if (furrowPoints.length >= 2) {
      furrow = createProgressLine({ points: furrowPoints, color: WEBGL_COLORS.alarm, widthPx: FURROW_WIDTH_PX });
      scene.add(furrow.line);
    }
  }
  /** The chain's shape at the primary cut, for the close-up (metres from the anchor along the ground, and up). */
  const primaryCutAnchor = locateAnchor(primaryCut.atMs);
  const primaryCutChain = primaryCutAnchor
    ? shapeCatenary({ paidOutMetres: chainState.nominalPaidOutMetres, heightMetres: primaryCutAnchor.span.heightMetres, laybackMetres: primaryCutAnchor.span.laybackMetres, pointCount: CLOSE_UP_CHAIN_POINT_COUNT })
    : null;

  const cutMarkers = input.cuts.map((cut) => {
    const point = toScene(cut.longitude, cut.latitude);
    const seabedY = sampleSeabedHeight(point.x, point.z) + 0.2;
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(CUT_RING_RADIUS_KM, 0.07, 10, 48), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm }));
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm, transparent: true, opacity: 0.7 }));
    beam.scale.y = -seabedY + 1.2;
    beam.position.y = (1.2 - seabedY) / 2;
    marker.add(ring, beam);
    marker.position.set(point.x, seabedY, point.z);
    marker.visible = false;
    // Cut labels hang below their point and the vessel's label sits above the vessel, so the two never
    // cover each other when the vessel passes a cut. A pipeline is holed or torn rather than cut through
    // (the Balticconnector), so its label says damaged and keeps the pipeline color.
    const isPipeline = features.lines.some((line) => line.name === cut.cableName && line.kind === "pipeline");
    const nameLabel = makeLabel(cut.label, isPipeline ? "pipeline" : "cable", "below");
    const cutLabel = makeLabel(`${cut.label} ${isPipeline ? "damaged" : "cut"}`, "alarm", "below");
    nameLabel.position.set(point.x, 1.6, point.z);
    cutLabel.position.copy(nameLabel.position);
    scene.add(marker, nameLabel, cutLabel);
    return { cut, marker, nameLabel, cutLabel };
  });

  // Each position placed from statements is a small ring on the track, so a click on it says how it was placed.
  const placementMarkers = input.placements.map((placement) => {
    const point = toScene(placement.longitude, placement.latitude);
    const marker = makePointMarker();
    marker.position.set(point.x, TRACK_SURFACE_LIFT, point.z);
    scene.add(marker);
    return marker;
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
  // The overview frames the whole track and every cut (the story at a glance: Svalbard's cut marker sits away from
  // the trawler's track); without a track it frames the block.
  const trackBounds = new THREE.Box3();
  [...trackScene, ...input.cuts.map((cut) => toScene(cut.longitude, cut.latitude))].forEach((point) => trackBounds.expandByPoint(new THREE.Vector3(point.x, OVERVIEW_TARGET_Y, point.z)));
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
  const chainPositions = new Float32Array(CHAIN_POINT_COUNT * 3);
  /**
   * Draws the chain from the anchor's shackle to the drawn hull's hawse with the catenary's shape: the physical curve
   * for the real span, stretched onto the drawn one (the hull is drawn 6 times and the water 20 times deeper).
   */
  function writeChain(span: { laybackMetres: number; heightMetres: number }) {
    const shape = shapeCatenary({ paidOutMetres: chainState.nominalPaidOutMetres, heightMetres: span.heightMetres, laybackMetres: span.laybackMetres, pointCount: CHAIN_POINT_COUNT });
    if (!shape.ok) return;
    shape.value.points.forEach((point, index) => {
      const across = span.laybackMetres > 0 ? point.alongMetres / span.laybackMetres : 0;
      const up = point.upMetres / span.heightMetres;
      chainPositions[index * 3] = shackleWorld.x + (hawseWorld.x - shackleWorld.x) * across;
      chainPositions[index * 3 + 1] = shackleWorld.y + (hawseWorld.y - shackleWorld.y) * up;
      chainPositions[index * 3 + 2] = shackleWorld.z + (hawseWorld.z - shackleWorld.z) * across;
    });
    chainGeometry.setPositions(chainPositions);
  }

  // Reused every frame instead of allocating.
  const sternWorld = new THREE.Vector3();
  const hawseWorld = new THREE.Vector3();
  const shackleWorld = new THREE.Vector3();
  const wakeTrail: ScenePoint[] = [];

  function update(atMs: number, deltaSeconds: number, nowSeconds: number) {
    water.setWaveTime((atMs - input.windowStartMs) / 1000);
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
      // Speed over the same span the heading reads (scene km are real km across the block).
      kelvinWake?.setSpeed((Math.hypot(after.x - before.x, after.z - before.z) * 1000) / ((2 * HEADING_SPAN_MS) / 1000));
      shipLabel.setNote(describeVesselPosition(input.track, atMs));
      vesselFrame = { position: ship.position, heading: lastHeading, drawnLengthKm: shipDrawnLengthKm };
      // The wake: the stern now, then the path sailed over the last minutes.
      sternWorld.copy(shipModel.sternLocal).applyMatrix4(ship.matrixWorld);
      const sternOffsetKm = sternWorld.distanceTo(ship.position);
      wakeTrail.length = 0;
      wakeTrail.push({ x: sternWorld.x, z: sternWorld.z });
      for (let sample = 1; sample <= WAKE_SAMPLE_COUNT; sample += 1) {
        const past = sceneAt(atMs - sample * WAKE_STEP_MS);
        if (!past) break;
        wakeTrail.push({ x: past.x - lastHeading.x * sternOffsetKm, z: past.z - lastHeading.z * sternOffsetKm });
      }
      wake.update(wakeTrail, wakeHalfWidthKm);
    } else {
      vesselFrame = null;
      wake.mesh.visible = false;
    }
    if (pastTrack) pastTrack.setFraction(totalTrackKm > 0 ? trackKmAt(atMs) / totalTrackKm : 0);

    const isDragging = dragWindow !== null && shipPoint !== null && atMs >= dragWindow.startMs && atMs <= dragWindow.endMs;
    if (furrow && dragWindow) furrow.setFraction((atMs - dragWindow.startMs) / (dragWindow.endMs - dragWindow.startMs));
    const located = isDragging ? locateAnchor(atMs) : null;
    anchor.visible = located !== null;
    chain.visible = located !== null;
    if (located) {
      // The anchor lies where the chain's layback puts it, shank pointing along the chain toward the hawse.
      hawseWorld.copy(shipModel.hawseLocal).applyMatrix4(ship.matrixWorld);
      const towardHawse = unitDirection(located.point, { x: hawseWorld.x, z: hawseWorld.z }, lastHeading);
      anchor.position.set(located.point.x, sampleSeabedHeight(located.point.x, located.point.z) + 0.02, located.point.z);
      anchor.rotation.set(-0.12, Math.atan2(towardHawse.x, towardHawse.z), 0);
      anchor.updateMatrixWorld();
      shackleWorld.copy(anchorModel.shackleLocal).applyMatrix4(anchor.matrixWorld);
      writeChain(located.span);
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

  function locateTarget(target: SceneTarget): { position: THREE.Vector3; label: HTMLElement } | null {
    switch (target.kind) {
      case "vessel":
        return ship.visible ? { position: ship.position, label: shipLabel.object.element } : null;
      case "cut": {
        const cutMarker = cutMarkers[target.cutIndex];
        if (!cutMarker) return null;
        // Before the cut the line's name marks the spot; once cut, the cut label replaces it.
        return { position: cutMarker.marker.position, label: (cutMarker.marker.visible ? cutMarker.cutLabel : cutMarker.nameLabel).element };
      }
      case "placement": {
        const marker = placementMarkers[target.positionIndex];
        return marker ? { position: marker.position, label: marker.element } : null;
      }
      default: {
        const unhandledTarget: never = target;
        return unhandledTarget;
      }
    }
  }

  function readPickables(): ScenePickable[] {
    const pickables: ScenePickable[] = ship.visible ? [{ target: { kind: "vessel" }, position: ship.position, label: shipLabel.object.element }] : [];
    cutMarkers.forEach((cutMarker, cutIndex) => {
      if (cutMarker.marker.visible) pickables.push({ target: { kind: "cut", cutIndex }, position: cutMarker.marker.position, label: cutMarker.cutLabel.element });
    });
    placementMarkers.forEach((marker, positionIndex) => {
      pickables.push({ target: { kind: "placement", positionIndex }, position: marker.position, label: marker.element });
    });
    return pickables;
  }

  function setCompactLabels(isCompact: boolean) {
    contextLabels.forEach((label) => {
      label.visible = !isCompact;
    });
  }

  function readColorProbes(cameraPosition: THREE.Vector3): ColorProbe[] {
    const probes: ColorProbe[] = [];
    for (const { tone, radius, tube } of dataTubes) {
      if (!tube.mesh.visible) continue;
      for (const share of COLOR_PROBE_SHARES) {
        const centre = tube.curve.getPointAt(share);
        centre.y += readThinnedTubeMiddle(radius, centre.distanceTo(cameraPosition), fullWidthDistanceKm);
        probes.push({ tone, position: centre });
      }
    }
    // The track up to the vessel, leaving out the stretch under the hull and the wake (the last minutes sailed).
    const revealedCount = pastTrack ? pastTrack.line.geometry.instanceCount + 1 : 0;
    const coveredFromMs = lastAtMs - WAKE_STEP_MS * WAKE_SAMPLE_COUNT;
    const drawnTrack = trackProbePoints.slice(0, revealedCount).filter((point) => point.atMs < coveredFromMs);
    for (const tone of ["suspect", "alarm"] as const) {
      const toned = drawnTrack.filter((point) => point.tone === tone);
      const step = Math.max(1, Math.floor(toned.length / TRACK_PROBES_PER_TONE));
      toned.forEach((point, index) => {
        if (index % step === 0) probes.push({ tone, position: point.position });
      });
    }
    for (const cutMarker of cutMarkers) {
      if (!cutMarker.marker.visible) continue;
      for (const angle of CUT_RING_PROBE_ANGLES) {
        probes.push({ tone: "alarm", position: new THREE.Vector3(Math.cos(angle) * CUT_RING_RADIUS_KM, 0, Math.sin(angle) * CUT_RING_RADIUS_KM).add(cutMarker.marker.position) });
      }
    }
    return probes;
  }

  return { scene, camera, controls, presets, primaryCutScene, trackDirection, cableDirection, primaryCutChain: primaryCutChain?.ok ? primaryCutChain.value : null, readVesselFrame: () => vesselFrame, locateTarget, readPickables, setCompactLabels, update, readColorProbes };
}
