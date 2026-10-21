import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { describeVesselPosition, positionAtTime, type ReplayCut, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import { makeLabel, makePointMarker, makeStackedLabel } from "@/lib/seabed/scene/labels";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createChainLinks, createFurrowTrench, createUnderwaterLook, makeIllustratedChip, type FurrowTrench } from "@/lib/seabed/scene/anchor-rig";
import { buildAnchorModel, createAnchorSteelMaterial } from "@/lib/seabed/scene/models";
import { createProgressLine, type ProgressLine } from "@/lib/seabed/scene/progress-line";
import { drawAfterWater } from "@/lib/render/data-colors";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { ScenePalette, SceneSky } from "@/lib/seabed/scene/scene-look";
import type { TerrainGrid } from "@/lib/seabed/scene/terrain-grid";
import { measureLevelIrradiance, type TerrainLighting } from "@/lib/seabed/scene/terrain-material";
import { createPhysicalLine, createSeabedLineMaterials, type PhysicalLine } from "@/lib/seabed/scene/seabed-lines";
import { buildWaterBody, createWaterDepthMap, WATER_ABSORPTION, WATER_LOOK } from "@/lib/seabed/scene/water-surface";
import { buildPolylineTube } from "@/lib/seabed/scene/polyline-tube";
import { FULL_WIDTH_DISTANCE_KM, MIN_WIDTH_SHARE, readThinnedTubeMiddle } from "@/lib/seabed/scene/tube-thinning";
import { createWake } from "@/lib/seabed/scene/wake";
import type { SeabedFeatures } from "@/lib/seabed/seabed-data";
import { buildShip } from "@/lib/ships/build-ship";
import { estimateCaseShipChain, readChainSpan, shapeCatenary, type ChainShape } from "@/lib/ships/anchor-chain";
import { createKelvinWake } from "@/lib/ships/kelvin-wake";
import { chooseSceneExaggeration, SCENE_SCALES } from "@/lib/seabed/scene-scales";
import { clipToBlock, densifyScenePoints, elevationToSceneY, type Projection, type ScenePoint } from "@/lib/seabed/terrain";

// Sediment the overview block stands on, below the deepest sounding (km).
const BLOCK_BASE_THICKNESS_KM = 2.6;
// Lines are resampled every 300 m so they follow the seabed.
const LINE_STEP_KM = 0.3;
// Faces around each map tube (and its casing and the signal's halo).
const TUBE_RADIAL_SEGMENTS = 8;
// Points on each side used to even out a line's height along the seabed.
const LINE_HEIGHT_SMOOTHING_POINTS = 4;
const POWER_CABLE_RADIUS_KM = 0.13;
const TELECOM_CABLE_RADIUS_KM = 0.075;
const PIPELINE_RADIUS_KM = 0.14;
const SIGNAL_HALO_RADIUS_KM = 0.42;
// Every data line sits on an opaque light casing (docs/UI_DESIGN_SYSTEM.md, Data: the map's white casing), approved for
// the 3D view on 19 Oct 2026 (plan/next-reset.md, choice 5): a tube's casing is this many times its radius, a screen
// line's this many device pixels wider. Drawn after the water and before the line, without writing depth, so the line
// shows over it and the terrain and hulls still hide both.
const CASING_RADIUS_SHARE = 1.8;
const CASING_EXTRA_PX = 3;
const CASING_RENDER_ORDER = 3.5;
const LINE_CASING = { color: WEBGL_COLORS.casing, extraPx: CASING_EXTRA_PX, renderOrder: CASING_RENDER_ORDER };
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
const CHAIN_WIDTH_PX = 2.5;
const CLOSE_UP_CHAIN_POINT_COUNT = 240;
// The chain as stud links: 0.5 m links (models.ts), at most this many, drawn when the camera is within this many km.
const CHAIN_LINK_PITCH_METRES = 0.5;
const CHAIN_LINK_COUNT = 260;
const CHAIN_LINK_VIEW_KM = 8;
// The furrow's trench: half as wide as the anchor's 2.5 m across the flukes on each side, drawn 12 m deep (about 0.6 m
// of sediment at the water's 20 times).
const FURROW_TRENCH_HALF_WIDTH_METRES = 1.4;
const FURROW_TRENCH_DEPTH_KM = 0.012;
// Layers: map labels on one (hidden under the water), the anchor's own label on another (shown only there).
const LABEL_LAYER = 1;
const ANCHOR_ROLL_RADIANS = 0.8;
// The anchor steel is lifted this share toward galvanised grey (models.ts): it stays dark to stand out under 75 m of water.
const ANCHOR_GALVANISED_SHARE = 0;
const UNDERWATER_LABEL_LAYER = 2;
const PLUME_PARTICLE_COUNT = 140;
// Heading is read over this span around the current moment, so a reconstructed corner does not snap the hull.
const HEADING_SPAN_MS = 2 * 60 * 1000;
// The light along the healthy cable takes this long to run its length.
const SIGNAL_LAP_SECONDS = 7;
// The signal light's size on screen (sprite scale without size attenuation): at the overview's 32 degree field of
// view, about 5% and 1.4% of the view's height.
const SIGNAL_GLOW_SCREEN_SCALE = 0.03;
const SIGNAL_CORE_SCREEN_SCALE = 0.008;
// Lookdev colour probes: shares along each data tube, how many points of each track tone are probed, and points
// around each cut marker's ring (radius in km, the ring's own).
const COLOR_PROBE_SHARES = [0.1, 0.3, 0.5, 0.7, 0.9];
const TRACK_PROBES_PER_TONE = 16;
// The lookdev continuity check follows the far tubes every this many km.
const TRACE_STEP_KM = 0.05;
// Probes hidden behind relief are dropped: the sight line to the camera is checked at this many points, starting
// this far (km) from the probe.
const OCCLUSION_STEPS = 64;
const OCCLUSION_START_KM = 0.15;
// The cut marker keeps one size on screen at every distance (plan/next-reset.md): a 24 px ring (its outer edge) with a
// 3 px stroke, and a 2 px beam 60 px tall rising from it, in CSS px. Built in px and scaled every frame to the km a
// pixel spans at the marker (fitScreenSizes).
const CUT_RING_RADIUS_PX = 10.5;
const CUT_RING_TUBE_RADIUS_PX = 1.5;
const CUT_BEAM_RADIUS_PX = 1;
const CUT_BEAM_HEIGHT_PX = 60;
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
// The look's haze (scene-look.ts): clear up to the camera's target, full this many times as far. Measured from the
// target, so every view (the gulf from 125 km, the hull from 2 km) fades its far ground alike.
const HAZE_FAR_SHARE = 6;
// The sky dome's gradient: the horizon colour at the horizon, the upper sky from this elevation up (degrees).
const SKY_UPPER_ELEVATION_DEGREES = 25;
// Where a storyboard looks for the anchor's pace: this far either side of the moment (ms).
const ANCHOR_PACE_SPAN_MS = 30 * 1000;
const KM_PER_NAUTICAL_MILE = 1.852;
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

/**
 * A point in the scene where a data line of one tone is drawn on the current frame (scripts/lookdev samples it), and
 * the line's drawn width there in km, or null for a line drawn a fixed number of pixels wide, and whether the line
 * sits on a casing (the map tubes, the track; not the close views' tracers or the cut ring).
 */
export type ColorProbe = { tone: DataTone; position: THREE.Vector3; widthKm: number | null; isCased: boolean };

/**
 * A cable or pipeline: its map tube, its physical twin for the close views (built in the refinement step, null before),
 * and whether the replay shows it at the drawn moment.
 */
type DataLine = { tone: DataTone; radius: number; tube: { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; restingPoints: THREE.Vector3[] }; physical: PhysicalLine | null; isShown: boolean };

/**
 * One data line's drawn path for the lookdev continuity check: its points in order, each with whether it is in sight
 * of the camera (not behind relief, the hull or a cut marker), so a gap there is the line's fault.
 */
export type LineTrace = { tone: DataTone; points: { position: THREE.Vector3; isInSight: boolean }[] };

/** A point of level, open seabed and the depth token it must show there (sRGB hex), for the lookdev seabed check. */
export type SeabedProbe = { position: THREE.Vector3; expectedHex: string };

/** A named thing a storyboard frame must show (explore/natural-look lookdev hook). */
export type SceneSubject = { name: string; position: THREE.Vector3 };

/** What the anchor cam states at a moment, from the engine's own anchor model (explore/natural-look). */
export type AnchorFacts = {
  waterDepthMetres: number;
  chainPaidOutMetres: number;
  laybackMetres: number;
  nearestCable: { name: string; distanceMetres: number } | null;
  anchorSpeedKnots: number;
};

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
  /** Points of level open seabed in sight of `cameraPosition`, nearer than the haze starts, and their palette colours, for the lookdev seabed check. */
  readSeabedProbes: (cameraPosition: THREE.Vector3) => SeabedProbe[];
  /** Builds the refinement's deferred parts (the ship's hull, the physical lines); hidden until revealRefinement. */
  prepareRefinement: (environment: THREE.Texture | null) => Promise<void>;
  /** Shows the vessel, its wakes, the anchor rig, the water and the signal, once their shaders are compiled. */
  revealRefinement: () => void;
  /** Keeps the sky around the camera and the haze measured from the camera's target. */
  followCamera: (cameraPosition: THREE.Vector3, targetDistanceKm: number) => void;
  /** Gives the screen-sized markers (the cut markers) their size for this camera and view height (CSS px); call before each draw. */
  fitScreenSizes: (viewCamera: THREE.PerspectiveCamera, viewportHeightPx: number) => void;
  /** Lookdev (explore/natural-look): named subjects at the last updated moment. */
  readSubjects: () => SceneSubject[];
  /** Whether the relief rises above the sight line from the camera to a point. */
  isBehindRelief: (point: THREE.Vector3, cameraPosition: THREE.Vector3) => boolean;
  /** The anchor cam's numbers at a moment, or null while the anchor is not down. */
  readAnchorFacts: (atMs: number) => AnchorFacts | null;
  /** Every shown data line's drawn path seen from `cameraPosition`, for the lookdev continuity check. */
  readLineTraces: (cameraPosition: THREE.Vector3) => LineTrace[];
  /** Where the anchor lies on the last drawn frame, or null while it is not drawn (lookdev contrast check). */
  readAnchorPosition: () => THREE.Vector3 | null;
  /** Hides the anchor (lookdev only: the contrast check draws the frame without it to find its pixels). */
  setAnchorHidden: (isHidden: boolean) => void;
};

type OverviewOptions = {
  /** The renderer's materials for custom shading (src/lib/render/scene-renderer.ts): GLSL on WebGL, TSL on WebGPU. */
  kit: SceneMaterialKit;
  domElement: HTMLElement;
  features: SeabedFeatures;
  /** The terrain's arrays, built off the main thread (terrain-grid.ts); its elevations are the drawn grid's. */
  terrainGrid: TerrainGrid;
  projection: Projection;
  sampleElevationMetres: (sceneX: number, sceneZ: number) => number;
  input: ReplaySceneInput;
  softDot: THREE.Texture;
  prefersReducedMotion: boolean;
  /** The GPU tiers (WebGL hardware, WebGPU): finer detail (hull plating relief, waves, ripples) a CPU renderer would pay for every frame. */
  isHighDetail: boolean;
  /** The sand-ripple detail normal map (GPU tier), or null. */
  rippleNormalMap: THREE.Texture | null;
  /** Environment colours of the look drawn (scene-look.ts). */
  palette: ScenePalette;
  /** The CC0 sky HDRI (linear equirectangular) for the water's reflection and the ships' light (GPU tiers), or null. */
  skyMap: THREE.Texture | null;
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

type TerrainLook = { lighting: TerrainLighting; rippleNormalMap: THREE.Texture | null; kit: SceneMaterialKit };

/** The terrain mesh on the arrays the worker built: heights, the look's colours, normals and the baked occlusion. */
function buildTerrainMesh(terrainGrid: TerrainGrid, projection: Projection, look: TerrainLook): THREE.Mesh {
  const { lighting, rippleNormalMap, kit } = look;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(terrainGrid.indices, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(terrainGrid.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(terrainGrid.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(terrainGrid.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(terrainGrid.colors, 3));
  geometry.setAttribute("elevation", new THREE.BufferAttribute(terrainGrid.elevations, 1));
  geometry.setAttribute("reliefOcclusion", new THREE.BufferAttribute(terrainGrid.occlusion, 1));
  geometry.computeBoundingSphere();
  if (rippleNormalMap) rippleNormalMap.repeat.set(projection.widthKm / RIPPLE_TILE_KM, projection.depthKm / RIPPLE_TILE_KM);
  const mesh = new THREE.Mesh(geometry, kit.createTerrainMaterial(lighting, rippleNormalMap));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Level, open seabed for the lookdev seabed check: the normal within 2.6 degrees of vertical, the baked occlusion
// over 0.98, at least 1 m deep, picked on a sparse lattice of the grid.
const SEABED_PROBE_LATTICE = 23;
const SEABED_PROBE_MIN_NORMAL_Y = 0.999;
const SEABED_PROBE_MIN_OPENNESS = 0.98;
// Probes keep this many grid cells from the block's edge, where the water's white rim and the cut face are drawn.
const SEABED_PROBE_EDGE_CELLS = 4;

function pickSeabedProbes(terrain: THREE.Mesh, grid: { width: number; height: number }): SeabedProbe[] {
  const positions = terrain.geometry.getAttribute("position");
  const normals = terrain.geometry.getAttribute("normal");
  const colors = terrain.geometry.getAttribute("color");
  const elevations = terrain.geometry.getAttribute("elevation");
  const openness = terrain.geometry.getAttribute("reliefOcclusion");
  const probeColor = new THREE.Color();
  const probes: SeabedProbe[] = [];
  for (let index = 0; index < positions.count; index += SEABED_PROBE_LATTICE) {
    const column = index % grid.width;
    const row = Math.floor(index / grid.width);
    const isNearEdge = Math.min(column, row, grid.width - 1 - column, grid.height - 1 - row) < SEABED_PROBE_EDGE_CELLS;
    if (isNearEdge || elevations.getX(index) > -1 || normals.getY(index) < SEABED_PROBE_MIN_NORMAL_Y || openness.getX(index) < SEABED_PROBE_MIN_OPENNESS) continue;
    probeColor.fromBufferAttribute(colors, index);
    probes.push({ position: new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index)), expectedHex: `#${probeColor.getHexString().toUpperCase()}` });
  }
  return probes;
}

/** What a surface facing `normal` receives from the sun and the sky, as a luminance (three.js light units). */
function measureIrradiance(normal: THREE.Vector3, sun: THREE.DirectionalLight, sky: THREE.HemisphereLight): number {
  const sunDirection = sun.position.clone().normalize();
  const sunLight = sun.color.clone().multiplyScalar(sun.intensity * Math.max(0, normal.dot(sunDirection)));
  const skyLight = sky.groundColor.clone().lerp(sky.color, 0.5 * normal.y + 0.5).multiplyScalar(sky.intensity);
  const total = sunLight.add(skyLight);
  return 0.2126 * total.r + 0.7152 * total.g + 0.0722 * total.b;
}

/**
 * The four cut faces of the block: from the terrain edge down to the base, darker toward the base (the look's colours),
 * each face shaded by the light it receives over what level ground receives, as the terrain is (terrain-material.ts).
 * The shade is baked into the colours, so the faces draw unlit with the sky dome's shader: one program less on the
 * way to the first frame.
 */
function buildBlockSides(terrain: THREE.Mesh, features: SeabedFeatures, baseY: number, palette: ScenePalette, lights: { sun: THREE.DirectionalLight; sky: THREE.HemisphereLight }): THREE.Mesh {
  const positions = terrain.geometry.getAttribute("position");
  const { width, height } = features.grid;
  const readVertex = (row: number, column: number) => {
    const index = row * width + column;
    return { x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) };
  };
  // Each face with the way it looks: north, south, west and east.
  const faces = [
    { edge: Array.from({ length: width }, (_slot, column) => readVertex(0, column)), outward: new THREE.Vector3(0, 0, -1) },
    { edge: Array.from({ length: width }, (_slot, column) => readVertex(height - 1, column)), outward: new THREE.Vector3(0, 0, 1) },
    { edge: Array.from({ length: height }, (_slot, row) => readVertex(row, 0)), outward: new THREE.Vector3(-1, 0, 0) },
    { edge: Array.from({ length: height }, (_slot, row) => readVertex(row, width - 1)), outward: new THREE.Vector3(1, 0, 0) },
  ];
  const levelIrradiance = measureIrradiance(new THREE.Vector3(0, 1, 0), lights.sun, lights.sky);
  const vertices: number[] = [];
  const colors: number[] = [];
  for (const { edge, outward } of faces) {
    const shade = Math.min(1, measureIrradiance(outward, lights.sun, lights.sky) / levelIrradiance);
    const topColor = new THREE.Color(palette.blockTopHex).multiplyScalar(shade).toArray();
    const baseColor = new THREE.Color(palette.blockBaseHex).multiplyScalar(shade).toArray();
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
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  mesh.castShadow = true;
  return mesh;
}

/** A tube's material and its casing's (a thinned tube of CASING_RADIUS_SHARE times the radius, in the casing colour). */
type TubeMaterials = { line: THREE.Material; casing: THREE.Material };

// A tube resting on the seabed on its casing; its height is evened out along the line so it does not jitter over every
// ridge. The casing is a child of the tube's mesh, so it shows and hides with it.
function createSeabedTube(points: readonly ScenePoint[], radius: number, materials: TubeMaterials, sampleSeabedHeight: (sceneX: number, sceneZ: number) => number) {
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
  // Where the line rests on the seabed (for its physical twin, seabed-lines.ts).
  const restingPoints = vectors.map((vector) => new THREE.Vector3(vector.x, vector.y - radius - 0.04, vector.z));
  // The spline, for what follows the line later (the signal, the probes, the physical twin); its samples are taken
  // only when asked for.
  const curve = new THREE.CatmullRomCurve3(vectors, false, "centripetal");
  // Data tubes are drawn unlit and after the water (src/lib/render/data-colors.ts), so they show their exact colour.
  const mesh = drawAfterWater(new THREE.Mesh(createPolylineTubeGeometry(vectors, radius), materials.line));
  mesh.castShadow = true;
  // The casing's underside rests on the seabed with the line's, so its centreline sits higher by the extra radius. It
  // is the line's tube widened in place (same rings, same normals), which costs a pass over its vertices instead of a
  // second TubeGeometry.
  const casing = new THREE.Mesh(widenTube(mesh.geometry, radius, radius * CASING_RADIUS_SHARE), materials.casing);
  casing.renderOrder = CASING_RENDER_ORDER;
  mesh.add(casing);
  return { mesh, curve, restingPoints, centreline: vectors };
}

/**
 * A tube with one ring per point of the line (polyline-tube.ts): the points are already resampled every 300 m, and
 * the map draws the tubes a few pixels wide, so sampling the spline for each ring (TubeGeometry) only cost time on the
 * way to the first frame (about 650 ms on a phone).
 */
function createPolylineTubeGeometry(points: readonly THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const tube = buildPolylineTube(points, radius, TUBE_RADIAL_SEGMENTS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(tube.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(tube.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(tube.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(tube.indices, 1));
  return geometry;
}

/**
 * A copy of a tube of `radius` at `widerRadius`, its underside where the tube's was: each vertex is the centreline point
 * (the vertex less its normal times the radius), lifted by the extra radius, plus the normal times the wider radius.
 */
function widenTube(tube: THREE.BufferGeometry, radius: number, widerRadius: number): THREE.BufferGeometry {
  const positions = tube.getAttribute("position");
  const normals = tube.getAttribute("normal");
  const widened = new Float32Array(positions.count * 3);
  const lift = widerRadius - radius;
  for (let index = 0; index < positions.count; index += 1) {
    const normalX = normals.getX(index);
    const normalY = normals.getY(index);
    const normalZ = normals.getZ(index);
    widened[index * 3] = positions.getX(index) + normalX * lift;
    widened[index * 3 + 1] = positions.getY(index) + normalY * lift + lift;
    widened[index * 3 + 2] = positions.getZ(index) + normalZ * lift;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(widened, 3));
  geometry.setAttribute("normal", normals);
  const index = tube.getIndex();
  if (index) geometry.setIndex(index);
  return geometry;
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

/**
 * The look's sky: a dome around the camera, the horizon colour at eye level fading to the upper sky by
 * SKY_UPPER_ELEVATION_DEGREES, the haze below the horizon (what the block stands in). Unlit, untouched by tone mapping
 * and haze, drawn before everything else, so each pixel of open sky is a palette colour.
 */
function buildSkyDome(sky: SceneSky, radiusKm: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radiusKm, 48, 32);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const upper = new THREE.Color(sky.upperHex);
  const horizon = new THREE.Color(sky.horizonHex);
  const haze = new THREE.Color(sky.hazeHex);
  const vertexColor = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const elevationDegrees = (Math.asin(clampUnit(positions.getY(index) / radiusKm)) * 180) / Math.PI;
    if (elevationDegrees < 0) vertexColor.copy(haze);
    else vertexColor.copy(horizon).lerp(upper, Math.min(1, elevationDegrees / SKY_UPPER_ELEVATION_DEGREES));
    vertexColor.toArray(colors, index * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Seen from inside, so either side shows the same; drawn double-sided to share its shader with the block's faces.
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Shortest distance (km) from a point to a polyline in scene x and z. Also read by the stage's hover readout. */
export function measureDistanceToPolyline(point: ScenePoint, line: readonly ScenePoint[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    if (!start || !end) continue;
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    const along = lengthSquared > 0 ? Math.min(1, Math.max(0, ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - (start.x + segmentX * along), point.z - (start.z + segmentZ * along)));
  }
  return nearest;
}

export function buildOverview(options: OverviewOptions): OverviewScene {
  const { kit, features, terrainGrid, projection, sampleElevationMetres, input, softDot, prefersReducedMotion, palette } = options;
  const elevations = terrainGrid.elevations;
  // Deep areas are drawn less exaggerated than the shallow Baltic (scene-scales.ts); the page states the same factors.
  const exaggeration = chooseSceneExaggeration(features.elevationRange);
  const sampleSeabedHeight = (sceneX: number, sceneZ: number) => elevationToSceneY(sampleElevationMetres(sceneX, sceneZ), exaggeration);
  const deepestElevation = elevations.reduce((deepest, elevation) => Math.min(deepest, elevation), 0);
  const deepestY = elevationToSceneY(deepestElevation, exaggeration);
  const baseY = deepestY - BLOCK_BASE_THICKNESS_KM;
  const toScene = (longitude: number, latitude: number) => projection.toScene(longitude, latitude);

  const scene = new THREE.Scene();
  // No environment map on the overview: the terrain is shaded by the sun and the sky alone, and the first frame need
  // not wait for a prefiltered room. The ships and the anchor reflect the sky HDRI on the GPU tiers; on the software
  // tier the refinement gets the room's reflections when it is prepared (prepareRefinement).
  // Everything about the vessel and the water is drawn once its shaders are ready (prepareRefinement, revealRefinement):
  // the first frame is the block, its data lines and the labels.
  const refinement = new THREE.Group();
  refinement.visible = false;
  scene.add(refinement);
  const skyLight = new THREE.HemisphereLight(palette.skyLightHex, palette.groundLightHex, 0.95);
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

  const terrain = buildTerrainMesh(terrainGrid, projection, {
    lighting: { levelIrradiance: measureLevelIrradiance(sunLight, skyLight), environment: { texture: null, intensity: 0 } },
    rippleNormalMap: options.rippleNormalMap,
    kit,
  });
  const seabedProbeCandidates = pickSeabedProbes(terrain, terrainGrid.grid);
  const water = buildWaterBody({
    projection,
    deepestY,
    kit,
    surface: { hasWaves: options.isHighDetail, sun: sunLight, look: WATER_LOOK, sky: options.skyMap, depthMap: createWaterDepthMap(elevations, features.grid, projection) },
  });
  scene.add(terrain, buildBlockSides(terrain, features, baseY, palette, { sun: sunLight, sky: skyLight }));
  refinement.add(water.group);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(blockRadiusKm * 6, blockRadiusKm * 6), new THREE.ShadowMaterial({ opacity: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = baseY - 0.02;
  ground.receiveShadow = true;
  refinement.add(ground);

  const tubeScale = Math.max(1, projection.widthKm / REFERENCE_BLOCK_WIDTH_KM);
  const tubeRadii = {
    power: POWER_CABLE_RADIUS_KM * tubeScale,
    telecom: TELECOM_CABLE_RADIUS_KM * tubeScale,
    pipeline: PIPELINE_RADIUS_KM * tubeScale,
    signalHalo: SIGNAL_HALO_RADIUS_KM * tubeScale,
  };
  const fullWidthDistanceKm = FULL_WIDTH_DISTANCE_KM * tubeScale;
  // One material per tube radius: each narrows with camera distance from its own radius (tube-thinning.ts).
  const createTubeMaterials = (hex: string, radiusKm: number): TubeMaterials => ({
    line: kit.createThinnedDataTubeMaterial({ hex, radiusKm, fullWidthDistanceKm }),
    casing: kit.createThinnedDataTubeMaterial({ hex: WEBGL_COLORS.casing, radiusKm: radiusKm * CASING_RADIUS_SHARE, fullWidthDistanceKm, depthWrite: false }),
  });
  const cableMaterials = { power: createTubeMaterials(WEBGL_COLORS.cable, tubeRadii.power), telecom: createTubeMaterials(WEBGL_COLORS.cable, tubeRadii.telecom) };
  const pipelineMaterial = createTubeMaterials(WEBGL_COLORS.pipeline, tubeRadii.pipeline);

  const primaryCut = input.cuts[0];
  const primaryCutScene = toScene(primaryCut.longitude, primaryCut.latitude);
  let cableDirection: ScenePoint = { x: 1, z: 0 };
  let signalCurve: THREE.CatmullRomCurve3 | null = null;
  let signalStopCurve: THREE.CatmullRomCurve3 | null = null;
  const pipelineCurves = new Map<string, THREE.CatmullRomCurve3[]>();
  // Every data line: its map tube, its physical twin for the close views, and whether the replay shows it now (a cut
  // cable's pieces only once it is cut). Read by the colour probes too.
  const dataTubes: DataLine[] = [];
  function addDataLine(tone: DataTone, radius: number, tube: ReturnType<typeof createSeabedTube>, isShown: boolean): DataLine {
    scene.add(tube.mesh);
    const dataLine: DataLine = { tone, radius, tube, physical: null, isShown };
    dataTubes.push(dataLine);
    return dataLine;
  }
  // Each cut cable swaps its intact line for two pieces once its cut time has passed.
  const cutSwitches: { cut: ReplayCut; intact: DataLine; halo: THREE.Object3D | null; pieces: DataLine[] }[] = [];

  for (const line of features.lines) {
    const scenePoints = densifyScenePoints(line.points.map(([longitude, latitude]) => toScene(longitude, latitude)), LINE_STEP_KM);
    for (const run of clipToBlock(scenePoints, projection)) {
      if (line.kind === "pipeline") {
        const pipeline = createSeabedTube(run, tubeRadii.pipeline, pipelineMaterial, sampleSeabedHeight);
        addDataLine("pipeline", tubeRadii.pipeline, pipeline, true);
        pipelineCurves.set(line.name, [...(pipelineCurves.get(line.name) ?? []), pipeline.curve]);
        continue;
      }
      const radius = tubeRadii[line.kind];
      const cableMaterial = cableMaterials[line.kind];
      const intact = createSeabedTube(run, radius, cableMaterial, sampleSeabedHeight);
      const intactLine = addDataLine("cable", radius, intact, true);
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
      const pieces = [addDataLine("cable", radius, before, false), addDataLine("cable", radius, after, false)];
      let halo: THREE.Object3D | null = null;
      if (cut === primaryCut) {
        // The signature "signal": a faint halo and a light that runs along the cable under watch.
        halo = new THREE.Mesh(
          createPolylineTubeGeometry(intact.centreline, tubeRadii.signalHalo),
          kit.createThinnedDataTubeMaterial({ hex: WEBGL_COLORS.cable, radiusKm: tubeRadii.signalHalo, fullWidthDistanceKm, opacity: 0.12, depthWrite: false }),
        );
        drawAfterWater(halo);
        scene.add(halo);
        signalCurve = intact.curve;
        signalStopCurve = before.curve;
        const previous = run[Math.max(0, nearest.index - 2)];
        const next = run[Math.min(run.length - 1, nearest.index + 2)];
        if (previous && next) cableDirection = unitDirection(previous, next, cableDirection);
      }
      cutSwitches.push({ cut, intact: intactLine, halo, pieces });
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

  // The signal's light keeps one size on screen whatever the framing: sized in km it filled a short track's close
  // framing as a white dome. Drawn over the relief so a ridge never cuts it in half.
  const signalCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, color: SCENE_COLORS.signalCore, sizeAttenuation: false, depthTest: false, depthWrite: false }));
  signalCore.scale.setScalar(SIGNAL_CORE_SCREEN_SCALE);
  const signalGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDot, color: SCENE_COLORS.signalGlow, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }),
  );
  signalGlow.scale.setScalar(SIGNAL_GLOW_SCREEN_SCALE);
  const signal = new THREE.Group();
  signal.add(signalCore, signalGlow);
  signal.visible = signalCurve !== null;
  refinement.add(signal);

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
    pastTrack = createProgressLine({ points: trackPoints, color: trackColors, widthPx: TRACK_WIDTH_PX, kit, casing: LINE_CASING });
    scene.add(drawAfterWater(pastTrack.line));
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
  // Its hull is built after the first frame (prepareRefinement): the ship is part of the refinement, hidden till then.
  const shipModel = buildShip({ kind: input.vessel.kind, lengthMetres: input.vessel.lengthMetres, tone: "suspect", isDetailed: options.isHighDetail, sky: options.skyMap, isHullDeferred: true });
  const ship = shipModel.group;
  ship.scale.setScalar(SHIP_DRAWN_SCALE * METRES_TO_KM);
  const shipDrawnLengthKm = input.vessel.lengthMetres * SHIP_DRAWN_SCALE * METRES_TO_KM;
  // The foam trail starts as wide as the drawn hull.
  const wakeHalfWidthKm = shipModel.form.halfBeam * SHIP_DRAWN_SCALE * METRES_TO_KM;
  const shipLabel = makeStackedLabel(input.vessel.name, describeVesselPosition(input.track, input.windowStartMs), "above");
  shipLabel.object.position.set(0, SHIP_LABEL_HEIGHT_LENGTHS * input.vessel.lengthMetres, 0);
  ship.add(shipLabel.object);
  ship.visible = false;
  refinement.add(ship);
  // The detail level streams in after the first frame: its code loads with a dynamic import (ship-detail.ts).
  const shipDetail = import("@/lib/ships/ship-detail")
    .then(({ addShipDetail }) => addShipDetail(shipModel, input.vessel.name))
    .catch((error: unknown) => console.error(`[buildOverview] the ship's detail level did not load: ${error instanceof Error ? error.message : String(error)}`));
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
  const kelvinWake = options.isHighDetail ? createKelvinWake(shipModel.form, kit, WATER_LOOK.column) : null;
  if (kelvinWake) ship.add(kelvinWake.mesh);
  const wake = createWake();
  refinement.add(wake.mesh);
  const anchorMaterial = createAnchorSteelMaterial(SCENE_COLORS.anchor, options.skyMap, ANCHOR_GALVANISED_SHARE);
  const anchorModel = buildAnchorModel(anchorMaterial);
  const anchor = anchorModel.group;
  anchor.scale.setScalar(ANCHOR_DRAWN_SCALE * METRES_TO_KM);
  anchor.visible = false;
  refinement.add(anchor);
  // Under the water (the anchor cam) the anchor carries one small chip saying it is illustrated: its shape is the
  // type's and its size 30 times life, which the disclosure under the view states.
  const anchorChip = makeIllustratedChip();
  anchorChip.position.set(0, 1.6, 2);
  anchorChip.layers.set(UNDERWATER_LABEL_LAYER);
  anchor.add(anchorChip);
  // Close up, the chain is real stud links at the anchor's drawn scale; from afar, the hairline below.
  const chainLinks = createChainLinks(anchorMaterial, CHAIN_LINK_COUNT, CHAIN_LINK_PITCH_METRES * ANCHOR_DRAWN_SCALE * METRES_TO_KM, ANCHOR_DRAWN_SCALE * METRES_TO_KM);
  chainLinks.mesh.visible = false;
  refinement.add(chainLinks.mesh);
  const chainGeometry = new LineGeometry();
  chainGeometry.setPositions(new Float32Array(CHAIN_POINT_COUNT * 3));
  const chain = kit.createScreenLine(chainGeometry, { color: SCENE_COLORS.anchor, widthPx: CHAIN_WIDTH_PX, hasVertexColors: false, opacity: 1 });
  chain.frustumCulled = false;
  chain.visible = false;
  // Drawn after the water (not in a data colour): the chain's run down from the hawse stays readable through the sea.
  chain.renderOrder = 4;
  if (!Array.isArray(chain.material)) chain.material.transparent = true;
  refinement.add(chain);

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
  let furrowTrench: FurrowTrench | null = null;
  if (dragWindow && dragWindow.endMs > dragWindow.startMs) {
    const furrowPoints = Array.from({ length: FURROW_SEGMENTS + 1 }, (_slot, index) => locateAnchor(dragWindow.startMs + ((dragWindow.endMs - dragWindow.startMs) * index) / FURROW_SEGMENTS))
      .flatMap((located) => (located ? [located.point] : []))
      .map((point) => new THREE.Vector3(point.x, sampleSeabedHeight(point.x, point.z) + FURROW_SEABED_LIFT, point.z));
    if (furrowPoints.length >= 2) {
      furrow = createProgressLine({ points: furrowPoints, color: WEBGL_COLORS.alarm, widthPx: FURROW_WIDTH_PX, kit, casing: LINE_CASING });
      scene.add(drawAfterWater(furrow.line));
      // The trench itself, in the sediment under the line: about the anchor's drawn width, as deep as its flukes dig.
      const seabedRamp = buildRamp(palette.depthRamp);
      const readSeabedColor = (sceneX: number, sceneZ: number, target: THREE.Color) => sampleRamp(seabedRamp, -sampleElevationMetres(sceneX, sceneZ), target);
      furrowTrench = createFurrowTrench(furrowPoints, FURROW_TRENCH_HALF_WIDTH_METRES * ANCHOR_DRAWN_SCALE * METRES_TO_KM, FURROW_TRENCH_DEPTH_KM, sampleSeabedHeight, readSeabedColor);
      refinement.add(furrowTrench.mesh);
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
    // The tubes' material with a radius of 0, which thins nothing: the marker draws with the tubes' shader program, so
    // the first frame links one program fewer (about 75 ms on a GPU without parallel shader compile).
    const ring = drawAfterWater(new THREE.Mesh(new THREE.TorusGeometry(CUT_RING_RADIUS_PX, CUT_RING_TUBE_RADIUS_PX, 10, 48), kit.createThinnedDataTubeMaterial({ hex: WEBGL_COLORS.alarm, radiusKm: 0, fullWidthDistanceKm: FULL_WIDTH_DISTANCE_KM })));
    ring.rotation.x = Math.PI / 2;
    const beamGeometry = new THREE.CylinderGeometry(CUT_BEAM_RADIUS_PX, CUT_BEAM_RADIUS_PX, CUT_BEAM_HEIGHT_PX, 8);
    beamGeometry.translate(0, CUT_BEAM_HEIGHT_PX / 2, 0);
    const beam = drawAfterWater(new THREE.Mesh(beamGeometry, kit.createThinnedDataTubeMaterial({ hex: WEBGL_COLORS.alarm, radiusKm: 0, fullWidthDistanceKm: FULL_WIDTH_DISTANCE_KM, opacity: 0.7, depthWrite: false })));
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
    // km per CSS px at the marker on the last frame (fitScreenSizes); the marker group carries it as its scale.
    return { cut, marker, nameLabel, cutLabel, kmPerPx: 0 };
  });

  // Each position placed from statements is a small ring on the track, so a click on it says how it was placed.
  const placementMarkers = input.placements.map((placement) => {
    const point = toScene(placement.longitude, placement.latitude);
    const marker = makePointMarker();
    marker.position.set(point.x, TRACK_SURFACE_LIFT, point.z);
    scene.add(marker);
    return marker;
  });

  const plume = kit.createSoftPoints(PLUME_PARTICLE_COUNT, { map: softDot, color: SCENE_COLORS.plume, size: 0.55, opacity: 0.55 });
  const plumePositions = plume.positions;
  const plumeAges = new Float32Array(PLUME_PARTICLE_COUNT).fill(2);
  const plumeDrift = Array.from({ length: PLUME_PARTICLE_COUNT }, () => new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5));
  refinement.add(plume.object);

  const halfFovTangent = Math.tan(((OVERVIEW_FOV_DEGREES / 2) * Math.PI) / 180);
  const topHeightKm = Math.max(projection.depthKm, projection.widthKm / TOP_VIEW_ASPECT) / (2 * halfFovTangent) + 4;
  const camera = new THREE.PerspectiveCamera(OVERVIEW_FOV_DEGREES, 1, 0.1, topHeightKm * 4);
  const controls = new OrbitControls(camera, options.domElement);
  // The sky is drawn inside the far plane, around the camera, and distant ground hazes toward it.
  const skyDome = buildSkyDome(palette.sky, topHeightKm * 2);
  const haze = new THREE.Fog(palette.sky.hazeHex, 1, 1 + HAZE_FAR_SHARE);
  scene.add(skyDome);
  scene.fog = haze;
  const underwaterLook = createUnderwaterLook(WATER_LOOK, sampleSeabedHeight, haze);
  refinement.add(underwaterLook.group);
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
  // Whether the anchor lies on the seabed at the drawn moment, and whether lookdev asked for it hidden.
  let isAnchorDrawn = false;
  let isAnchorHidden = false;
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
    if (furrowTrench && dragWindow) furrowTrench.setFraction((atMs - dragWindow.startMs) / (dragWindow.endMs - dragWindow.startMs));
    const located = isDragging ? locateAnchor(atMs) : null;
    isAnchorDrawn = located !== null;
    anchor.visible = isAnchorDrawn && !isAnchorHidden;
    chain.visible = located !== null;
    chainLinks.mesh.visible = false;
    if (located) {
      // The anchor lies where the chain's layback puts it, shank pointing along the chain toward the hawse.
      hawseWorld.copy(shipModel.hawseLocal).applyMatrix4(ship.matrixWorld);
      const towardHawse = unitDirection(located.point, { x: hawseWorld.x, z: hawseWorld.z }, lastHeading);
      anchor.position.set(located.point.x, sampleSeabedHeight(located.point.x, located.point.z) + 0.02, located.point.z);
      // Rolled onto one side, as a dragged anchor lies: one fluke dug in, the other's blade turned up (as in the close-up).
      anchor.rotation.set(-0.12, Math.atan2(towardHawse.x, towardHawse.z), ANCHOR_ROLL_RADIANS, "YXZ");
      anchor.updateMatrixWorld();
      shackleWorld.copy(anchorModel.shackleLocal).applyMatrix4(anchor.matrixWorld);
      writeChain(located.span);
      // Links where the camera is close enough to see them; the hairline otherwise.
      const isChainClose = camera.position.distanceTo(anchor.position) < CHAIN_LINK_VIEW_KM;
      chainLinks.mesh.visible = isChainClose;
      if (isChainClose) chainLinks.update(chainPositions, CHAIN_POINT_COUNT);
    }

    // A camera under the surface (the anchor cam) sees the inside of the water and no map labels.
    const isUnderwater = camera.position.y < 0;
    underwaterLook.apply(scene, camera, isUnderwater);
    water.group.visible = !isUnderwater;
    camera.layers.set(0);
    camera.layers.enable(isUnderwater ? UNDERWATER_LABEL_LAYER : LABEL_LAYER);

    for (const cutSwitch of cutSwitches) {
      const isCut = atMs >= cutSwitch.cut.atMs;
      cutSwitch.intact.isShown = !isCut;
      cutSwitch.pieces.forEach((piece) => {
        piece.isShown = isCut;
      });
    }
    // Close to the seabed's lines (the Vessel view) each is drawn as the thing it is, carrying its tracer; from the map's
    // height, as the crisp data-coloured tube. The signal's halo belongs to the map.
    const isClose = isCloseToLines(camera.position);
    for (const dataLine of dataTubes) {
      // Until the refinement brings the physical twins, the map tube stands in for them up close.
      dataLine.tube.mesh.visible = dataLine.isShown && (!isClose || !dataLine.physical);
      if (dataLine.physical) dataLine.physical.group.visible = dataLine.isShown && isClose;
    }
    for (const cutSwitch of cutSwitches) if (cutSwitch.halo) cutSwitch.halo.visible = cutSwitch.intact.isShown && !isClose;
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
        signalGlow.scale.setScalar(SIGNAL_GLOW_SCREEN_SCALE * pulse);
        signalGlow.material.color.set(SCENE_COLORS.cutGlow);
        signalCore.material.color.set(SCENE_COLORS.cutCore);
      } else {
        signal.position.copy(signalCurve.getPointAt(prefersReducedMotion ? 0.3 : (nowSeconds / SIGNAL_LAP_SECONDS) % 1));
        signalGlow.scale.setScalar(SIGNAL_GLOW_SCREEN_SCALE);
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
    plume.markMoved();
  }

  /**
   * Builds what the first frame left out (the physical lines; the ship's detail level arrives) and gives the refinement's
   * lit materials `environment` where they reflect nothing else. It stays hidden: the viewer compiles its
   * shaders in the background, then calls revealRefinement.
   */
  async function prepareRefinement(environment: THREE.Texture | null): Promise<void> {
    shipModel.addHull();
    const lineMaterials = createSeabedLineMaterials();
    for (const dataLine of dataTubes) {
      const { tone, radius, tube } = dataLine;
      const physical = createPhysicalLine({ restingPoints: tube.restingPoints, radiusKm: radius * MIN_WIDTH_SHARE, kind: tone === "pipeline" ? "pipeline" : "cable", hex: tone === "pipeline" ? WEBGL_COLORS.pipeline : WEBGL_COLORS.cable, materials: lineMaterials, kit, sampleSeabedHeight });
      physical.group.visible = false;
      refinement.add(physical.group);
      dataLine.physical = physical;
    }
    await shipDetail;
    if (environment) {
      refinement.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material instanceof THREE.MeshStandardMaterial && material.envMap === null) material.envMap = environment;
      });
    }
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

  /** Whether a camera is low enough to see the lines as things (the absorption's height: water-surface.ts). */
  function isCloseToLines(cameraPosition: THREE.Vector3): boolean {
    return cameraPosition.y < WATER_ABSORPTION.fadeHeightKm[0];
  }

  function readColorProbes(cameraPosition: THREE.Vector3): ColorProbe[] {
    const probes: ColorProbe[] = [];
    const isClose = isCloseToLines(cameraPosition);
    for (const { tone, radius, tube, physical, isShown } of dataTubes) {
      if (!isShown) continue;
      if (isClose && physical) {
        // The tracer is a fixed number of pixels wide: its centreline is the probe.
        COLOR_PROBE_SHARES.forEach((share) => probes.push({ tone, position: physical.tracerCurve.getPointAt(share), widthKm: null, isCased: false }));
        continue;
      }
      for (const share of COLOR_PROBE_SHARES) {
        const centre = tube.curve.getPointAt(share);
        const middleOffsetKm = readThinnedTubeMiddle(radius, centre.distanceTo(cameraPosition), fullWidthDistanceKm);
        centre.y += middleOffsetKm;
        // The thinned tube is 2 r s wide, and its middle sits r (s - 1) above the centreline.
        probes.push({ tone, position: centre, widthKm: 2 * (radius + middleOffsetKm), isCased: true });
      }
    }
    // The track up to the vessel, leaving out the stretch under the hull and the wake (the last minutes sailed).
    const revealedCount = pastTrack ? pastTrack.readRevealedPointCount() : 0;
    const coveredFromMs = lastAtMs - WAKE_STEP_MS * WAKE_SAMPLE_COUNT;
    const drawnTrack = trackProbePoints.slice(0, revealedCount).filter((point) => point.atMs < coveredFromMs);
    for (const tone of ["suspect", "alarm"] as const) {
      const toned = drawnTrack.filter((point) => point.tone === tone);
      const step = Math.max(1, Math.floor(toned.length / TRACK_PROBES_PER_TONE));
      toned.forEach((point, index) => {
        if (index % step === 0) probes.push({ tone, position: point.position, widthKm: null, isCased: true });
      });
    }
    // A line or the track seen through the hull or a cut marker shows that object, not its own colour.
    const uncoveredProbes = probes.filter((probe) => !isCoveredInView(probe.position, cameraPosition));
    for (const cutMarker of cutMarkers) {
      if (!cutMarker.marker.visible) continue;
      for (const angle of CUT_RING_PROBE_ANGLES) {
        const ringRadiusKm = CUT_RING_RADIUS_PX * cutMarker.kmPerPx;
        const position = new THREE.Vector3(Math.cos(angle) * ringRadiusKm, 0, Math.sin(angle) * ringRadiusKm).add(cutMarker.marker.position);
        uncoveredProbes.push({ tone: "alarm", position, widthKm: 2 * CUT_RING_TUBE_RADIUS_PX * cutMarker.kmPerPx, isCased: false });
      }
    }
    return uncoveredProbes.filter((probe) => !isBehindRelief(probe.position, cameraPosition));
  }

  /** Whether the hull, or a cut marker's beam or ring, stands between the camera and a point. */
  function isCoveredInView(point: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    return isBehindHull(point, cameraPosition) || isBehindCutBeam(point, cameraPosition) || isBehindCutRing(point, cameraPosition);
  }

  /** Whether the sight line from the camera to a point passes through a shown cut marker's ring (a flat torus). */
  function isBehindCutRing(point: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    return cutMarkers.some((cutMarker) => {
      if (!cutMarker.marker.visible) return false;
      const ringY = cutMarker.marker.position.y;
      if ((cameraPosition.y - ringY) * (point.y - ringY) >= 0) return false;
      const share = (cameraPosition.y - ringY) / (cameraPosition.y - point.y);
      const crossingX = cameraPosition.x + (point.x - cameraPosition.x) * share;
      const crossingZ = cameraPosition.z + (point.z - cameraPosition.z) * share;
      const fromCentreKm = Math.hypot(crossingX - cutMarker.marker.position.x, crossingZ - cutMarker.marker.position.z);
      return Math.abs(fromCentreKm - CUT_RING_RADIUS_PX * cutMarker.kmPerPx) < CUT_RING_TUBE_RADIUS_PX * cutMarker.kmPerPx * 1.5;
    });
  }

  const markerInView = new THREE.Vector3();
  /** Scales each cut marker to its fixed size on screen for a camera and a view `viewportHeightPx` CSS px tall. */
  function fitScreenSizes(viewCamera: THREE.PerspectiveCamera, viewportHeightPx: number) {
    const pixelSpanAtUnitDepth = (2 * Math.tan(((viewCamera.fov / 2) * Math.PI) / 180)) / Math.max(1, viewportHeightPx);
    for (const cutMarker of cutMarkers) {
      // Depth along the view direction (the camera looks down its own negative z), held off the near plane.
      markerInView.copy(cutMarker.marker.position).applyMatrix4(viewCamera.matrixWorldInverse);
      cutMarker.kmPerPx = Math.max(viewCamera.near, -markerInView.z) * pixelSpanAtUnitDepth;
      cutMarker.marker.scale.setScalar(cutMarker.kmPerPx);
    }
  }

  function followCamera(cameraPosition: THREE.Vector3, targetDistanceKm: number) {
    skyDome.position.copy(cameraPosition);
    haze.near = targetDistanceKm;
    haze.far = targetDistanceKm * HAZE_FAR_SHARE;
  }

  function readSubjects(): SceneSubject[] {
    const subjects: SceneSubject[] = [];
    if (ship.visible) subjects.push({ name: "vessel", position: ship.position.clone() });
    if (anchor.visible) {
      subjects.push({ name: "anchor", position: anchor.position.clone() });
      subjects.push({ name: "hawse (chain top)", position: hawseWorld.clone() });
      const middle = Math.floor(CHAIN_POINT_COUNT / 2) * 3;
      subjects.push({ name: "chain middle", position: new THREE.Vector3(chainPositions[middle], chainPositions[middle + 1], chainPositions[middle + 2]) });
      // The furrow two minutes of drag behind the anchor: where it has just been.
      const behind = locateAnchor(lastAtMs - 2 * 60 * 1000);
      if (behind) subjects.push({ name: "furrow behind anchor", position: new THREE.Vector3(behind.point.x, sampleSeabedHeight(behind.point.x, behind.point.z) + FURROW_SEABED_LIFT, behind.point.z) });
    }
    for (const cutMarker of cutMarkers) subjects.push({ name: `${cutMarker.cut.label} cut point`, position: cutMarker.marker.position.clone() });
    // The whole track, drawn or not yet: eleven points evenly along it.
    for (let share = 0; share <= 10; share += 1) {
      const point = sceneAt(timeAtTrackKm((totalTrackKm * share) / 10));
      if (point) subjects.push({ name: `track ${share * 10}%`, position: new THREE.Vector3(point.x, TRACK_SURFACE_LIFT, point.z) });
    }
    return subjects;
  }

  const cableRuns = features.lines.filter((line) => line.kind !== "pipeline").map((line) => ({ name: line.name, points: line.points.map(([longitude, latitude]) => toScene(longitude, latitude)) }));
  function readAnchorFacts(atMs: number): AnchorFacts | null {
    const located = locateAnchor(atMs);
    if (!located || !dragWindow || atMs < dragWindow.startMs || atMs > dragWindow.endMs) return null;
    const before = locateAnchor(atMs - ANCHOR_PACE_SPAN_MS);
    const after = locateAnchor(atMs + ANCHOR_PACE_SPAN_MS);
    const paceKmPerHour = before && after ? (Math.hypot(after.point.x - before.point.x, after.point.z - before.point.z) / (2 * ANCHOR_PACE_SPAN_MS)) * 3600 * 1000 : 0;
    const nearestCable = cableRuns.reduce<{ name: string; distanceMetres: number } | null>((nearest, run) => {
      const distanceMetres = measureDistanceToPolyline(located.point, run.points) * 1000;
      return nearest === null || distanceMetres < nearest.distanceMetres ? { name: run.name, distanceMetres } : nearest;
    }, null);
    return {
      waterDepthMetres: -sampleElevationMetres(located.point.x, located.point.z),
      chainPaidOutMetres: chainState.nominalPaidOutMetres,
      laybackMetres: located.span.laybackMetres,
      nearestCable,
      anchorSpeedKnots: paceKmPerHour / KM_PER_NAUTICAL_MILE,
    };
  }

  function readSeabedProbes(cameraPosition: THREE.Vector3): SeabedProbe[] {
    // Only seabed in clear air: past the haze's near distance the approved haze mixes in by design (followCamera).
    return seabedProbeCandidates.filter((probe) => probe.position.distanceTo(cameraPosition) <= haze.near && !isBehindRelief(probe.position, cameraPosition));
  }

  // The hull's box in its own metres (waterline amidships at the origin), wide enough for the bridge wings: a sight
  // line through it counts as hidden by the ship.
  const hullBox = new THREE.Box3(
    new THREE.Vector3(-shipModel.form.halfLength * 1.05, -shipModel.form.draught, -shipModel.form.halfBeam * 1.6),
    new THREE.Vector3(shipModel.form.halfLength * 1.05, input.vessel.lengthMetres * 0.25, shipModel.form.halfBeam * 1.6),
  );
  const hullRay = new THREE.Ray();
  const hullHit = new THREE.Vector3();
  const shipInverse = new THREE.Matrix4();
  /** Whether the hull stands between the camera and a point. */
  function isBehindHull(point: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    if (!ship.visible) return false;
    shipInverse.copy(ship.matrixWorld).invert();
    const localCamera = cameraPosition.clone().applyMatrix4(shipInverse);
    const localPoint = point.clone().applyMatrix4(shipInverse);
    hullRay.set(localCamera, localPoint.clone().sub(localCamera).normalize());
    const hit = hullRay.intersectBox(hullBox, hullHit);
    return hit !== null && hit.distanceTo(localCamera) < localPoint.distanceTo(localCamera);
  }

  /**
   * Whether a shown cut marker's beam (a translucent alarm column from the seabed to above the surface) stands between
   * the camera and a point: the sight line passes within the beam's radius of its axis, at a height the beam covers.
   */
  function isBehindCutBeam(point: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    return cutMarkers.some((cutMarker) => {
      if (!cutMarker.marker.visible) return false;
      const beamX = cutMarker.marker.position.x;
      const beamZ = cutMarker.marker.position.z;
      const runX = point.x - cameraPosition.x;
      const runZ = point.z - cameraPosition.z;
      const runLengthSquared = runX * runX + runZ * runZ;
      if (runLengthSquared < 1e-12) return false;
      const share = ((beamX - cameraPosition.x) * runX + (beamZ - cameraPosition.z) * runZ) / runLengthSquared;
      if (share <= 0 || share >= 1) return false;
      const missKm = Math.hypot(cameraPosition.x + runX * share - beamX, cameraPosition.z + runZ * share - beamZ);
      const sightY = cameraPosition.y + (point.y - cameraPosition.y) * share;
      const beamTopY = cutMarker.marker.position.y + CUT_BEAM_HEIGHT_PX * cutMarker.kmPerPx;
      return missKm < CUT_BEAM_RADIUS_PX * cutMarker.kmPerPx * 1.5 && sightY > cutMarker.marker.position.y - 0.1 && sightY < beamTopY;
    });
  }

  function readLineTraces(cameraPosition: THREE.Vector3): LineTrace[] {
    const isClose = isCloseToLines(cameraPosition);
    return dataTubes.flatMap(({ tone, radius, tube, physical, isShown }) => {
      if (!isShown) return [];
      const positions = isClose && physical
        ? physical.tracerPoints.map((point) => point.clone())
        : tube.curve.getSpacedPoints(Math.max(12, Math.ceil(tube.curve.getLength() / TRACE_STEP_KM))).map((centre) => {
            centre.y += readThinnedTubeMiddle(radius, centre.distanceTo(cameraPosition), fullWidthDistanceKm);
            return centre;
          });
      return [
        {
          tone,
          points: positions.map((position) => ({ position, isInSight: !isBehindRelief(position, cameraPosition) && !isCoveredInView(position, cameraPosition) })),
        },
      ];
    });
  }

  /** Whether the terrain rises above the sight line from the camera to a point (a ridge hides what is behind it). */
  function isBehindRelief(point: THREE.Vector3, cameraPosition: THREE.Vector3): boolean {
    const sightKm = point.distanceTo(cameraPosition);
    // Skip the first stretch next to the point: a line rests on the very seabed it is drawn on.
    const startShare = Math.min(0.5, OCCLUSION_START_KM / sightKm);
    for (let step = 0; step < OCCLUSION_STEPS; step += 1) {
      // Samples crowd toward the point, where nearby relief hides the most.
      const amount = startShare + (1 - startShare) * (step / OCCLUSION_STEPS) ** 2;
      const sightX = point.x + (cameraPosition.x - point.x) * amount;
      const sightY = point.y + (cameraPosition.y - point.y) * amount;
      const sightZ = point.z + (cameraPosition.z - point.z) * amount;
      if (Math.abs(sightX) > projection.widthKm / 2 || Math.abs(sightZ) > projection.depthKm / 2) return false;
      if (sampleSeabedHeight(sightX, sightZ) > sightY) return true;
    }
    return false;
  }

  // Every map label lives on its own layer, so a camera under the water can leave them out (CSS2DRenderer tests layers).
  scene.traverse((object) => {
    if (object instanceof CSS2DObject && !object.layers.isEnabled(UNDERWATER_LABEL_LAYER)) object.layers.set(LABEL_LAYER);
  });
  camera.layers.enable(LABEL_LAYER);

  // The first frame casts no shadows: the shadow pass's shader and its first render cost about 250 ms here, and the
  // relief's shadows arrive with the refinement (revealRefinement turns them back on).
  const deferredShadowCasters: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (!object.castShadow) return;
    deferredShadowCasters.push(object);
    object.castShadow = false;
  });

  return {
    scene,
    camera,
    controls,
    presets,
    primaryCutScene,
    trackDirection,
    cableDirection,
    primaryCutChain: primaryCutChain?.ok ? primaryCutChain.value : null,
    readVesselFrame: () => vesselFrame,
    locateTarget,
    readPickables,
    setCompactLabels,
    update,
    readColorProbes,
    readSeabedProbes,
    prepareRefinement,
    revealRefinement() {
      refinement.visible = true;
      deferredShadowCasters.forEach((object) => {
        object.castShadow = true;
      });
    },
    followCamera,
    fitScreenSizes,
    readSubjects,
    isBehindRelief,
    readAnchorFacts,
    readLineTraces,
    readAnchorPosition: () => (isAnchorDrawn ? anchor.position : null),
    setAnchorHidden(isHidden) {
      isAnchorHidden = isHidden;
    },
  };
}
