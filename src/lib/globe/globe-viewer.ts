import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { detectRendererKind, type RendererKind } from "@/lib/diagnostics/webgl-renderer";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import type { FramePair } from "@/lib/globe/frame-pairing";
import { readDistanceTier, readPlanetShare, type DistanceTier } from "@/lib/globe/globe-tier";
import type { LandPolygons } from "@/lib/globe/land-polygons";
import { COVERAGE_HEIGHT, COVERAGE_WIDTH } from "@/lib/globe/coverage";
import { createLandTexture, WORLD_BOX, type LandBox } from "@/lib/globe/land-texture";
import type { ShipDensity } from "@/lib/globe/ship-density";
import { readLongitudeLatitude, writeUnitVector } from "@/lib/globe/sphere";
import { createGlobeLineLayer, LINE_LIFT, type GlobeLineLayer } from "@/lib/globe/globe-lines";
import type { GlobeLine } from "@/lib/globe/world-lines";
import type { BoundingBox } from "@/lib/regions/region";
import type { Result } from "@/lib/result";
import { hideOverlappingLabels, makeStackedLabel, type StackedLabel } from "@/lib/seabed/scene/labels";

// The /live globe: a unit sphere painted with land, every ship in a frame pair as one GPU point that blends between
// the pair's two positions, and the world's cables and pipelines (src/lib/globe/globe-lines.ts). Nothing is drawn unless the time, the
// camera, the data or the size changed, so an idle globe costs no frames.

/**
 * Drawing budget per renderer, as for the seabed (src/lib/seabed/scene/viewer.ts): a CPU renderer (SwiftShader in
 * headless tests) gets a smaller land texture, a coarser sphere and a low pixel ratio.
 */
const RENDER_TIERS: Record<RendererKind, { antialias: boolean; maxPixelRatio: number; landTextureWidth: number; detailTextureWidth: number; sphereSegments: number }> = {
  hardware: { antialias: true, maxPixelRatio: 2, landTextureWidth: 4096, detailTextureWidth: 4096, sphereSegments: 160 },
  software: { antialias: false, maxPixelRatio: 0.75, landTextureWidth: 2048, detailTextureWidth: 2048, sphereSegments: 64 },
};
// Northern Europe, where every replay happened and the recorder listens: a sharper land texture on a patch of sphere
// just above the globe, so the coasts stay crisp when the camera flies down to a ship (the world texture is 5 to 10 km
// a pixel; the patch about 1). It covers every seabed area in scripts/seabed/build-seabed.ts (15 to 32.5 E, 54 to 66 N).
const DETAIL_BOX: LandBox = { west: -12, east: 45, south: 48, north: 72 };
const DETAIL_RADIUS = 1.0003;
const RADIANS_PER_DEGREE = Math.PI / 180;
const CAMERA_FOV_DEGREES = 28;
// The globe opens over northern Europe, where the feeds hear the most ships and every replay happened.
const HOME_LONGITUDE = 16;
const HOME_LATITUDE = 50;
const HOME_DISTANCE = 3.6;
const MIN_DISTANCE = 1.08;
const MAX_DISTANCE = 6;
// Heights above the unit sphere: ships sit above the cables so a ship over a cable stays visible.
const SHIP_LIFT = 1.0012;
// Ship dots grow as the camera closes in, from this size at the home distance (CSS px), within these limits.
const SHIP_POINT_PX = 2.4;
const SHIP_POINT_MIN_PX = 1.8;
const SHIP_POINT_MAX_PX = 7;
const SELECTION_RING_PX = 18;
// A click lands on the nearest visible ship within this radius (CSS px); a press that moves farther is a drag.
const PICK_RADIUS_PX = 12;
// A line is picked within this radius, and a ship this close beats a line.
const LINE_PICK_RADIUS_PX = 6;
const CLICK_SLOP_PX = 5;
// Rotation slows as the camera closes in, so a drag moves the ground under the pointer at about the same pace.
const ROTATE_SPEED_PER_UNIT = 0.55;
// The faint rim that separates the pale globe from the pale page.
const RIM_RADIUS = 1.035;
// Focusing on a ship flies the camera to this distance from the centre (about 1,900 km above the ground) over this
// long (docs/UI_DESIGN_SYSTEM.md, Motion: duration-large for camera moves inside the UI).
const FOCUS_DISTANCE = 1.3;
const FOCUS_MOVE_MS = 900;
// The hatching over sea no feed heard (CSS px): a thin diagonal line every 7 px, in the depth-deep tone.
const HATCH_SPACING_PX = 7;
// Incident markers (CSS px), just above the ships; the selected one grows by this factor.
const MARKER_PX = 16;
const MARKER_SELECTED_SCALE = 1.375;
const MARKER_LIFT = 1.0016;
const MARKER_PICK_RADIUS_PX = 11;
// Flying from orbit down to a cut is the globe's one long move (docs/UI_DESIGN_SYSTEM.md, Live globe): long enough to
// follow the ground turning under the camera, on the standard in-out curve.
const DIVE_MOVE_MS = 1600;
const HATCH_LINE_PX = 1.2;
// The Planet tier's density dots (src/lib/globe/ship-density.ts): a dot's area grows with its ships up to this count,
// from the smallest dot that still reads at home distance (CSS px) to one about two cells wide, where the busiest
// coasts merge into one mass. 150 ships in a 2 degree cell (about 220 km) is a busy strait's approaches, such as Dover's.
const DENSITY_REFERENCE_COUNT = 150;
const DENSITY_DOT_MIN_PX = 2.6;
const DENSITY_DOT_MAX_PX = 14;
const DENSITY_LIFT = 1.001;
// Andy's pick on board 25 (20 Oct 2026): the approved water teal, so the field reads as ships at sea, not as data ink.
const DENSITY_TONE = WEBGL_COLORS.density;
const DENSITY_ALPHA = 0.78;
// The watched regions' outlines, just above the cables, from the Sea tier down: ink at a low opacity, so a box reads as
// "recorded here" without competing with the data lines.
const REGION_OUTLINE_TONE = WEBGL_COLORS.ink;
const REGION_OUTLINE_ALPHA = 0.32;
const REGION_OUTLINE_LIFT = 1.0008;
// Points per degree along a box edge, so a long parallel follows the sphere instead of cutting under it.
const OUTLINE_POINTS_PER_DEGREE = 2;
// Sea names show while the density field does, and only on the side facing the camera.
const SEA_LABEL_MIN_SHARE = 0.5;
// The fault ripple (src/lib/globe/fault-ripples.ts, approved by Andy on 20 Oct 2026): two alarm rings growing out of a
// cable over 3.2 s, half a period apart, on a sprite this wide (CSS px). It is the globe's third ambient loop, after the
// live ping and the cable signal; a calm globe (reduced motion, or a CPU renderer) draws one still ring instead.
const RIPPLE_PX = 64;
const RIPPLE_PERIOD_MS = 3200;
const RIPPLE_LIFT = 1.0017;

/** What a click on the globe landed on. */
export type GlobePick = { kind: "ship"; mmsi: number } | { kind: "line"; lineId: number } | { kind: "incident"; slug: string } | { kind: "none" };

/** Where the camera is: its tier and the point under the stage's centre. */
export type GlobeView = { tier: DistanceTier; longitude: number; latitude: number };

/** A named sea's label at the Planet tier: its name over a muted note (its ship count). */
export type GlobeSeaLabel = { name: string; note: string; longitude: number; latitude: number };

/** A cable cut on file, marked on the globe where its case places the primary cut. */
export type GlobeMarker = { slug: string; longitude: number; latitude: number };

export type GlobeViewer = {
  /** The two frames to blend between, or null while none is loaded. */
  setFramePair: (pair: FramePair | null) => void;
  /** Where the moment sits between the pair's frames, 0 to 1. */
  setBlend: (blend: number) => void;
  setSelectedShip: (mmsi: number | null) => void;
  /** The cables and pipelines to draw (world and watched, src/lib/globe/world-lines.ts); replaces any drawn before. */
  setLines: (lines: readonly GlobeLine[]) => void;
  /** The incidents to mark (src/lib/globe/incidents.ts), and the one drawn larger as selected. */
  setIncidents: (markers: readonly GlobeMarker[]) => void;
  setSelectedIncident: (slug: string | null) => void;
  /**
   * Flies the camera down over a place, ending at `distance` from the centre (the closest the globe allows when left
   * out). Resolves when the camera arrives, or at once when motion is reduced or `isJump` asks for no flight (a view
   * restored from the address); resolves early if a drag takes over.
   */
  flyTo: (target: { longitude: number; latitude: number; distance?: number; durationMs?: number; isJump?: boolean }) => Promise<void>;
  /** Draws one line on a white casing above the rest, or none. */
  setSelectedLine: (lineId: number | null) => void;
  /** Where the feeds heard ships (src/lib/globe/coverage.ts, renderCoverageMask), or null to hatch nothing. */
  setCoverage: (mask: Uint8Array | null) => void;
  /** Flies the camera over a ship of the current pair, to `distance` from the centre (about 1,900 km up when left out); false when the pair does not hold it. */
  focusShip: (mmsi: number, distance?: number) => boolean;
  /** Width of a panel floating over the right edge (CSS px); the globe centres on what is left. */
  setRightInset: (insetPx: number) => void;
  /** The Planet tier's density dots for the moment, or null for none. */
  setDensity: (density: ShipDensity | null) => void;
  /** The seas to name at the Planet tier, busiest first: where two overlap on screen, the earlier one shows. */
  setSeaLabels: (labels: readonly GlobeSeaLabel[]) => void;
  /** The watched regions' boxes, outlined from the Sea tier down. */
  setRegionOutlines: (boxes: readonly BoundingBox[]) => void;
  /** Where a fault signal of the recorded day names a cable: a ripple on each, or none. */
  setRipples: (points: readonly { longitude: number; latitude: number }[]) => void;
  /** The point under the stage's centre. */
  readCentre: () => { longitude: number; latitude: number };
  resetView: () => void;
  dispose: () => void;
};

type GlobeViewerOptions = {
  container: HTMLElement;
  land: LandPolygons;
  /** Called with what a click landed on. */
  onPick: (pick: GlobePick) => void;
  /** Called after every drawn frame the camera moved in; cheap callers compare before they set state. */
  onViewChange: (view: GlobeView) => void;
  prefersReducedMotion: boolean;
};

const GLOBE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying vec3 vSurface;
  void main() {
    vUv = uv;
    vSurface = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// The texture holds the palette as raw sRGB bytes; the limb darkens a little so the sphere reads round. Sea the feeds
// did not hear (the coverage mask, src/lib/globe/coverage.ts) is hatched in screen space, the cartographer's mark for
// "no data", so it never reads as an empty sea. The mask is indexed by longitude and latitude from the surface point,
// which serves the world sphere and the sharper patch over northern Europe alike.
const GLOBE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uLand;
  uniform sampler2D uCoverage;
  uniform float uHasCoverage;
  uniform vec3 uWater;
  uniform vec3 uHatch;
  uniform float uHatchSpacing;
  uniform float uHatchHalfWidth;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying vec3 vSurface;
  const float PI = 3.141592653589793;
  void main() {
    vec3 color = texture2D(uLand, vUv).rgb;
    vec3 surface = normalize(vSurface);
    vec2 coverageUv = vec2((atan(-surface.z, surface.x) + PI) / (2.0 * PI), (0.5 * PI - asin(clamp(surface.y, -1.0, 1.0))) / PI);
    float heard = texture2D(uCoverage, coverageUv).r;
    float water = 1.0 - smoothstep(0.015, 0.05, distance(color, uWater));
    float stripe = abs(fract((gl_FragCoord.x + gl_FragCoord.y) / uHatchSpacing) - 0.5) * uHatchSpacing;
    float hatch = 1.0 - smoothstep(uHatchHalfWidth - 0.5, uHatchHalfWidth + 0.5, stripe);
    color = mix(color, uHatch, hatch * water * (1.0 - heard) * uHasCoverage);
    float facing = clamp(dot(normalize(vNormal), normalize(vViewDirection)), 0.0, 1.0);
    gl_FragColor = vec4(color * mix(0.86, 1.0, sqrt(facing)), 1.0);
  }
`;

const RIM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vViewDirection)));
    gl_FragColor = vec4(uColor, pow(facing, 3.0) * 0.55);
  }
`;

const SHIP_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aFromPresence;
  attribute float aToPresence;
  uniform float uBlend;
  uniform float uPointSize;
  uniform float uLift;
  varying float vPresence;
  void main() {
    vec3 direction = normalize(mix(aFrom, aTo, uBlend));
    vPresence = mix(aFromPresence, aToPresence, uBlend);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(direction * uLift, 1.0);
    gl_PointSize = uPointSize;
  }
`;

// Colors are written as given (sRGB hex), so the ship tone matches the token exactly. uOpacity fades the dots out as
// the Planet tier's density field takes over.
const SHIP_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vPresence;
  void main() {
    float edge = 1.0 - smoothstep(0.36, 0.5, length(gl_PointCoord - 0.5));
    float alpha = edge * vPresence * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// A density dot's area grows with its cell's ships (radius with the square root), so the eye reads area as count.
const DENSITY_VERTEX_SHADER = /* glsl */ `
  attribute float aCount;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform float uReference;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uMinPx + (uMaxPx - uMinPx) * sqrt(min(aCount / uReference, 1.0));
  }
`;

const DENSITY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float edge = 1.0 - smoothstep(0.38, 0.5, length(gl_PointCoord - 0.5));
    float alpha = edge * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const OUTLINE_VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OUTLINE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

const RIPPLE_VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

// Each ring grows from the cable to the sprite's edge and fades as it goes; uIsStill holds one ring at mid size.
const RIPPLE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPhase;
  uniform float uIsStill;
  float ring(float radius, float phase) {
    float ringRadius = mix(0.06, 0.48, phase);
    float band = 1.0 - smoothstep(0.012, 0.03, abs(radius - ringRadius));
    return band * (1.0 - phase);
  }
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float alpha = uIsStill > 0.5 ? ring(radius, 0.45) * 1.6 : max(ring(radius, uPhase), ring(radius, fract(uPhase + 0.5)));
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, min(alpha, 0.9));
  }
`;

// The break marker of the design system (Signature element): a white disc with an alarm ring and an alarm centre.
const MARKER_VERTEX_SHADER = /* glsl */ `
  attribute float aScale;
  uniform float uPointSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize * aScale;
  }
`;

const MARKER_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uDisc;
  uniform vec3 uAlarm;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float disc = 1.0 - smoothstep(0.46, 0.5, radius);
    if (disc < 0.02) discard;
    float ring = smoothstep(0.27, 0.31, radius) * (1.0 - smoothstep(0.37, 0.41, radius));
    float centre = 1.0 - smoothstep(0.11, 0.15, radius);
    gl_FragColor = vec4(mix(uDisc, uAlarm, max(ring, centre)), disc);
  }
`;

const RING_VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float ring = smoothstep(0.30, 0.34, radius) * (1.0 - smoothstep(0.44, 0.48, radius));
    float core = 1.0 - smoothstep(0.12, 0.16, radius);
    float alpha = max(ring, core);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** A palette hex as raw sRGB channels for a shader uniform (no color management, so the value stays exact). */
function toRawColor(hex: string): THREE.Vector3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** A box's outline on the sphere as line segment pairs, its parallels and meridians cut into short steps. */
function buildBoxOutline(box: BoundingBox, lift: number): Float32Array {
  const corners: [number, number][] = [
    [box.west, box.south],
    [box.east, box.south],
    [box.east, box.north],
    [box.west, box.north],
  ];
  const points: number[] = [];
  const step = new Float32Array(3);
  corners.forEach(([startLongitude, startLatitude], index) => {
    const [endLongitude, endLatitude] = corners[(index + 1) % corners.length] ?? corners[0] ?? [0, 0];
    const stepCount = Math.max(1, Math.ceil(Math.max(Math.abs(endLongitude - startLongitude), Math.abs(endLatitude - startLatitude)) * OUTLINE_POINTS_PER_DEGREE));
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      for (const share of [stepIndex / stepCount, (stepIndex + 1) / stepCount]) {
        writeUnitVector(startLongitude + (endLongitude - startLongitude) * share, startLatitude + (endLatitude - startLatitude) * share, step, 0);
        points.push((step[0] ?? 0) * lift, (step[1] ?? 0) * lift, (step[2] ?? 0) * lift);
      }
    }
  });
  return Float32Array.from(points);
}

function cameraPositionFor(longitude: number, latitude: number, distance: number): THREE.Vector3 {
  const direction = new Float32Array(3);
  writeUnitVector(longitude, latitude, direction, 0);
  return new THREE.Vector3(direction[0], direction[1], direction[2]).multiplyScalar(distance);
}

/** Builds the globe inside `container` and starts drawing on demand. Never throws. */
export function createGlobeViewer(options: GlobeViewerOptions): Result<GlobeViewer> {
  const { container, land, onPick, onViewChange, prefersReducedMotion } = options;
  const rendererKind = detectRendererKind();
  const tier = RENDER_TIERS[rendererKind];
  const isCalm = prefersReducedMotion || rendererKind === "software";
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: tier.antialias, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    return { ok: false, reason: `WebGL 2 is not available: ${error instanceof Error ? error.message : String(error)}` };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.outline = "none";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.dataset.renderer = rendererKind;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.01, 50);
  camera.position.copy(cameraPositionFor(HOME_LONGITUDE, HOME_LATITUDE, HOME_DISTANCE));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.zoomSpeed = 0.8;
  controls.enableDamping = !isCalm;
  controls.dampingFactor = 0.12;

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const landTexture = createLandTexture(land, { box: WORLD_BOX, width: tier.landTextureWidth, height: tier.landTextureWidth / 2 });
  landTexture.anisotropy = anisotropy;
  const detailTexture = createLandTexture(land, { box: DETAIL_BOX, width: tier.detailTextureWidth, height: tier.detailTextureWidth / 2 });
  detailTexture.anisotropy = anisotropy;
  // Until the first frame lands nothing is known about coverage, so nothing is hatched.
  const coverageData = new Uint8Array(COVERAGE_WIDTH * COVERAGE_HEIGHT);
  const coverageTexture = new THREE.DataTexture(coverageData, COVERAGE_WIDTH, COVERAGE_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
  coverageTexture.magFilter = THREE.LinearFilter;
  coverageTexture.minFilter = THREE.LinearFilter;
  coverageTexture.wrapS = THREE.RepeatWrapping;
  coverageTexture.needsUpdate = true;
  // Shared by both surface materials, so one update reaches the world sphere and the northern Europe patch.
  const coverageUniforms = {
    uCoverage: { value: coverageTexture },
    uHasCoverage: { value: 0 },
    uWater: { value: toRawColor(WEBGL_COLORS.depth40) },
    uHatch: { value: toRawColor(WEBGL_COLORS.depthDeep) },
    uHatchSpacing: { value: HATCH_SPACING_PX },
    uHatchHalfWidth: { value: HATCH_LINE_PX / 2 },
  };
  const createSurfaceMaterial = (texture: THREE.Texture) =>
    new THREE.ShaderMaterial({ uniforms: { uLand: { value: texture }, ...coverageUniforms }, vertexShader: GLOBE_VERTEX_SHADER, fragmentShader: GLOBE_FRAGMENT_SHADER });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, tier.sphereSegments, tier.sphereSegments / 2), createSurfaceMaterial(landTexture));
  // SphereGeometry puts u = 0 at -x and u = 0.25 at +z, the same frame as writeUnitVector (longitude -180 at -x,
  // -90 at +z), and v = 0 at the north pole: the equirectangular land texture lines up with the ships unrotated.
  scene.add(globe);
  // SphereGeometry measures phi from longitude -180 and theta from the north pole, so the box maps straight onto it.
  const detail = new THREE.Mesh(
    new THREE.SphereGeometry(
      DETAIL_RADIUS,
      tier.sphereSegments / 2,
      tier.sphereSegments / 4,
      (DETAIL_BOX.west + 180) * RADIANS_PER_DEGREE,
      (DETAIL_BOX.east - DETAIL_BOX.west) * RADIANS_PER_DEGREE,
      (90 - DETAIL_BOX.north) * RADIANS_PER_DEGREE,
      (DETAIL_BOX.north - DETAIL_BOX.south) * RADIANS_PER_DEGREE,
    ),
    createSurfaceMaterial(detailTexture),
  );
  scene.add(detail);
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(RIM_RADIUS, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: toRawColor(WEBGL_COLORS.depth40) } },
      vertexShader: GLOBE_VERTEX_SHADER,
      fragmentShader: RIM_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(rim);
  let lineLayer: GlobeLineLayer | null = null;
  let selectedLineId: number | null = null;

  const shipGeometry = new THREE.BufferGeometry();
  const shipMaterial = new THREE.ShaderMaterial({
    uniforms: { uBlend: { value: 0 }, uPointSize: { value: SHIP_POINT_PX }, uLift: { value: SHIP_LIFT }, uColor: { value: toRawColor(WEBGL_COLORS.ship) }, uOpacity: { value: 1 } },
    vertexShader: SHIP_VERTEX_SHADER,
    fragmentShader: SHIP_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const ships = new THREE.Points(shipGeometry, shipMaterial);
  // The blended positions live in the shader, so three.js cannot compute bounds to cull against.
  ships.frustumCulled = false;
  // Ships draw after the lines' halos and lights, so a ship over a watched cable stays crisp.
  ships.renderOrder = 5;
  scene.add(ships);

  const ringPosition = new Float32Array(3);
  const ringGeometry = new THREE.BufferGeometry();
  ringGeometry.setAttribute("position", new THREE.BufferAttribute(ringPosition, 3));
  const ring = new THREE.Points(
    ringGeometry,
    new THREE.ShaderMaterial({
      uniforms: { uPointSize: { value: SELECTION_RING_PX }, uColor: { value: toRawColor(WEBGL_COLORS.ink) } },
      vertexShader: RING_VERTEX_SHADER,
      fragmentShader: RING_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }),
  );
  ring.frustumCulled = false;
  ring.visible = false;
  ring.renderOrder = 6;
  scene.add(ring);

  const markerGeometry = new THREE.BufferGeometry();
  const markerMaterial = new THREE.ShaderMaterial({
    uniforms: { uPointSize: { value: MARKER_PX }, uDisc: { value: toRawColor(WEBGL_COLORS.casing) }, uAlarm: { value: toRawColor(WEBGL_COLORS.alarm) } },
    vertexShader: MARKER_VERTEX_SHADER,
    fragmentShader: MARKER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const markerPoints = new THREE.Points(markerGeometry, markerMaterial);
  markerPoints.frustumCulled = false;
  // Above the ships and the selection ring: a cut on file is the rarest thing on the globe.
  markerPoints.renderOrder = 7;
  scene.add(markerPoints);
  let markers: readonly GlobeMarker[] = [];
  let markerPositions = new Float32Array(0);
  let markerScales = new Float32Array(0);
  let selectedIncident: string | null = null;
  function placeMarkers() {
    markerPositions = new Float32Array(markers.length * 3);
    markerScales = new Float32Array(markers.length);
    markers.forEach((marker, index) => {
      writeUnitVector(marker.longitude, marker.latitude, markerPositions, index * 3);
      for (let axis = 0; axis < 3; axis += 1) markerPositions[index * 3 + axis] = (markerPositions[index * 3 + axis] ?? 0) * MARKER_LIFT;
      markerScales[index] = marker.slug === selectedIncident ? MARKER_SELECTED_SCALE : 1;
    });
    markerGeometry.setAttribute("position", new THREE.BufferAttribute(markerPositions, 3));
    markerGeometry.setAttribute("aScale", new THREE.BufferAttribute(markerScales, 1));
    markerGeometry.setDrawRange(0, markers.length);
    markDirty();
  }

  const densityGeometry = new THREE.BufferGeometry();
  const densityMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMinPx: { value: DENSITY_DOT_MIN_PX },
      uMaxPx: { value: DENSITY_DOT_MAX_PX },
      uReference: { value: DENSITY_REFERENCE_COUNT },
      uColor: { value: toRawColor(DENSITY_TONE) },
      uOpacity: { value: 0 },
    },
    vertexShader: DENSITY_VERTEX_SHADER,
    fragmentShader: DENSITY_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const densityPoints = new THREE.Points(densityGeometry, densityMaterial);
  densityPoints.frustumCulled = false;
  densityPoints.renderOrder = 4;
  densityPoints.visible = false;
  scene.add(densityPoints);
  let hasDensity = false;

  const outlineMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: toRawColor(REGION_OUTLINE_TONE) }, uOpacity: { value: 0 } },
    vertexShader: OUTLINE_VERTEX_SHADER,
    fragmentShader: OUTLINE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const outlineGeometry = new THREE.BufferGeometry();
  const outlines = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outlines.frustumCulled = false;
  outlines.renderOrder = 3;
  scene.add(outlines);

  const rippleGeometry = new THREE.BufferGeometry();
  const rippleMaterial = new THREE.ShaderMaterial({
    uniforms: { uPointSize: { value: RIPPLE_PX }, uColor: { value: toRawColor(WEBGL_COLORS.alarm) }, uPhase: { value: 0 }, uIsStill: { value: isCalm ? 1 : 0 } },
    vertexShader: RIPPLE_VERTEX_SHADER,
    fragmentShader: RIPPLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const ripplePoints = new THREE.Points(rippleGeometry, rippleMaterial);
  ripplePoints.frustumCulled = false;
  // Under the cut markers, above the ships.
  ripplePoints.renderOrder = 6;
  scene.add(ripplePoints);
  let rippleDirections: THREE.Vector3[] = [];

  // Sea names are HTML labels in their own scene, so the label renderer walks only them.
  const labelScene = new THREE.Scene();
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);
  // Keyed by sea name, so a new count only rewrites the label's note while the day plays.
  let seaLabels = new Map<string, { label: StackedLabel; direction: THREE.Vector3 }>();

  let pair: FramePair | null = null;
  let blend = 0;
  let selectedMmsi: number | null = null;
  let isDirty = true;
  const markDirty = () => {
    isDirty = true;
  };
  controls.addEventListener("change", markDirty);
  type CameraMove = { from: THREE.Vector3; to: THREE.Vector3; startedAt: number; durationMs: number; ease: (amount: number) => number; onEnd: () => void };
  let cameraMove: CameraMove | null = null;
  // Grabbing the globe ends a scripted flight.
  const stopCameraMove = () => {
    cameraMove?.onEnd();
    cameraMove = null;
  };
  // Ease out cubic for a short hop to a ship, as the seabed's camera moves do.
  const easeOutCubic = (amount: number) => 1 - (1 - amount) ** 3;
  // ease-standard, cubic-bezier(0.4, 0, 0.2, 1) (docs/UI_DESIGN_SYSTEM.md, Motion), solved for the curve's x.
  const easeStandard = (amount: number) => {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const middle = (low + high) / 2;
      const curveX = 3 * (1 - middle) ** 2 * middle * 0.4 + 3 * (1 - middle) * middle ** 2 * 0.2 + middle ** 3;
      if (curveX < amount) low = middle;
      else high = middle;
    }
    const share = (low + high) / 2;
    return 3 * (1 - share) * share ** 2 + share ** 3;
  };
  function startCameraMove(destination: THREE.Vector3, durationMs: number, ease: (amount: number) => number, isJump: boolean): Promise<void> {
    stopCameraMove();
    markDirty();
    if (isJump) {
      camera.position.copy(destination);
      controls.update();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      cameraMove = { from: camera.position.clone(), to: destination, startedAt: performance.now(), durationMs, ease, onEnd: resolve };
    });
  }
  controls.addEventListener("start", stopCameraMove);

  /** Index of an MMSI in the current pair (ascending), or -1. */
  function findShipIndex(mmsi: number): number {
    if (!pair) return -1;
    let low = 0;
    let high = pair.shipCount - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const value = pair.mmsi[middle] ?? 0;
      if (value === mmsi) return middle;
      if (value < mmsi) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  /** The ship's blended position (unit sphere times the ship lift) and presence at the current blend. */
  function readShip(shipIndex: number, target: THREE.Vector3): number {
    if (!pair) return 0;
    const offset = shipIndex * 3;
    target
      .set(
        (pair.fromPositions[offset] ?? 0) * (1 - blend) + (pair.toPositions[offset] ?? 0) * blend,
        (pair.fromPositions[offset + 1] ?? 0) * (1 - blend) + (pair.toPositions[offset + 1] ?? 0) * blend,
        (pair.fromPositions[offset + 2] ?? 0) * (1 - blend) + (pair.toPositions[offset + 2] ?? 0) * blend,
      )
      .normalize()
      .multiplyScalar(SHIP_LIFT);
    return (pair.fromPresence[shipIndex] ?? 0) * (1 - blend) + (pair.toPresence[shipIndex] ?? 0) * blend;
  }

  const ringVector = new THREE.Vector3();
  function placeRing() {
    const shipIndex = selectedMmsi === null ? -1 : findShipIndex(selectedMmsi);
    const presence = shipIndex === -1 ? 0 : readShip(shipIndex, ringVector);
    ring.visible = presence > 0.05;
    if (!ring.visible) return;
    ringPosition[0] = ringVector.x;
    ringPosition[1] = ringVector.y;
    ringPosition[2] = ringVector.z;
    ringGeometry.attributes.position.needsUpdate = true;
  }

  let rightInsetPx = 0;
  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    const shiftPx = Math.min(rightInsetPx / 2, width / 4);
    if (shiftPx > 0) camera.setViewOffset(width, height, shiftPx, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    lineLayer?.setResolution(width, height);
    markDirty();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // A click picks what lies under the pointer; a press that turns into a drag rotates the globe and picks nothing.
  let pressStart: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    pressStart = { x: event.clientX, y: event.clientY };
  };
  const pickVector = new THREE.Vector3();
  type ScreenPoint = { x: number; y: number; isFacing: boolean };
  function toScreen(pointX: number, pointY: number, pointZ: number, bounds: DOMRect, lift: number): ScreenPoint {
    pickVector.set(pointX, pointY, pointZ);
    // A point on the sphere faces the camera when its dot product with the camera position exceeds its own lift.
    const isFacing = pickVector.dot(camera.position) > lift;
    pickVector.project(camera);
    return { x: ((pickVector.x + 1) / 2) * bounds.width, y: ((1 - pickVector.y) / 2) * bounds.height, isFacing };
  }

  /** The nearest visible ship to a screen point, within the pick radius. */
  function pickShip(pointerX: number, pointerY: number, bounds: DOMRect): { mmsi: number; distance: number } | null {
    if (!pair) return null;
    let nearest: { mmsi: number; distance: number } | null = null;
    for (let shipIndex = 0; shipIndex < pair.shipCount; shipIndex += 1) {
      if (readShip(shipIndex, pickVector) < 0.5) continue;
      const point = toScreen(pickVector.x, pickVector.y, pickVector.z, bounds, SHIP_LIFT);
      if (!point.isFacing) continue;
      const distance = Math.hypot(point.x - pointerX, point.y - pointerY);
      if (distance < (nearest?.distance ?? PICK_RADIUS_PX)) nearest = { mmsi: pair.mmsi[shipIndex] ?? 0, distance };
    }
    return nearest;
  }

  /** The nearest visible line to a screen point, within the line pick radius. */
  function pickLine(pointerX: number, pointerY: number, bounds: DOMRect): { lineId: number; distance: number } | null {
    if (!lineLayer) return null;
    let nearest: { lineId: number; distance: number } | null = null;
    for (const { line, parts } of lineLayer.surfaceLines) {
      for (const part of parts) {
        let previous: ScreenPoint | null = null;
        for (let offset = 0; offset + 2 < part.length; offset += 3) {
          const point = toScreen(part[offset] ?? 0, part[offset + 1] ?? 0, part[offset + 2] ?? 0, bounds, LINE_LIFT);
          if (previous && previous.isFacing && point.isFacing) {
            const deltaX = point.x - previous.x;
            const deltaY = point.y - previous.y;
            const lengthSquared = deltaX * deltaX + deltaY * deltaY;
            const share = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((pointerX - previous.x) * deltaX + (pointerY - previous.y) * deltaY) / lengthSquared));
            const distance = Math.hypot(pointerX - (previous.x + share * deltaX), pointerY - (previous.y + share * deltaY));
            // Ties go to the watched copy of a line, which is listed after the world's copy.
            if (distance <= (nearest?.distance ?? LINE_PICK_RADIUS_PX)) nearest = { lineId: line.id, distance };
          }
          previous = point;
        }
      }
    }
    return nearest;
  }

  /** The nearest visible incident marker to a screen point, within its pick radius. */
  function pickIncident(pointerX: number, pointerY: number, bounds: DOMRect): string | null {
    let nearestSlug: string | null = null;
    let nearestDistance = MARKER_PICK_RADIUS_PX;
    for (let index = 0; index < markers.length; index += 1) {
      const point = toScreen(markerPositions[index * 3] ?? 0, markerPositions[index * 3 + 1] ?? 0, markerPositions[index * 3 + 2] ?? 0, bounds, MARKER_LIFT);
      const distance = Math.hypot(point.x - pointerX, point.y - pointerY);
      if (point.isFacing && distance < nearestDistance) {
        nearestDistance = distance;
        nearestSlug = markers[index]?.slug ?? null;
      }
    }
    return nearestSlug;
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!pressStart || Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > CLICK_SLOP_PX) {
      pressStart = null;
      return;
    }
    pressStart = null;
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const incident = pickIncident(pointerX, pointerY, bounds);
    if (incident !== null) {
      onPick({ kind: "incident", slug: incident });
      return;
    }
    const ship = pickShip(pointerX, pointerY, bounds);
    const line = pickLine(pointerX, pointerY, bounds);
    // A ship right under the pointer wins; then a line under it; then a ship a little farther off.
    if (ship && ship.distance <= LINE_PICK_RADIUS_PX) onPick({ kind: "ship", mmsi: ship.mmsi });
    else if (line) onPick({ kind: "line", lineId: line.lineId });
    else if (ship) onPick({ kind: "ship", mmsi: ship.mmsi });
    else onPick({ kind: "none" });
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  let frameHandle = 0;
  let isDisposed = false;
  const moveDirection = new THREE.Vector3();
  function stepCameraMove(now: number): boolean {
    if (!cameraMove) return false;
    const amount = Math.min(1, Math.max(0, (now - cameraMove.startedAt) / cameraMove.durationMs));
    const eased = cameraMove.ease(amount);
    const distance = cameraMove.from.length() + (cameraMove.to.length() - cameraMove.from.length()) * eased;
    moveDirection.copy(cameraMove.from).normalize().lerp(cameraMove.to.clone().normalize(), eased).normalize();
    camera.position.copy(moveDirection).multiplyScalar(distance);
    if (amount >= 1) {
      const finished = cameraMove;
      cameraMove = null;
      finished.onEnd();
    }
    return true;
  }

  // True while a watched cable's light runs on the side facing the camera: the globe then draws every frame.
  let isSignalRunning = false;
  // The first drawn frame reports the view even though the camera has not moved yet.
  let isFirstFrame = true;
  // True while a ripple faces the camera on a globe that moves: the globe then draws every frame, as for the signal.
  let isRippleRunning = false;
  function renderFrame(now: number) {
    frameHandle = requestAnimationFrame(renderFrame);
    const isFlying = stepCameraMove(now);
    const hasCameraMoved = controls.update() || isFlying;
    if (!isDirty && !hasCameraMoved && !isSignalRunning && !isRippleRunning) return;
    // A frame drawn only for a cable's running light leaves the labels where they are.
    const shouldPlaceLabels = isDirty || hasCameraMoved;
    isDirty = false;
    const distance = camera.position.length();
    controls.rotateSpeed = Math.max(0.05, Math.min(1, (distance - 1) * ROTATE_SPEED_PER_UNIT));
    const pixelRatio = renderer.getPixelRatio();
    const pointPx = Math.max(SHIP_POINT_MIN_PX, Math.min(SHIP_POINT_MAX_PX, SHIP_POINT_PX * ((HOME_DISTANCE - 1) / Math.max(0.02, distance - 1)) ** 0.5));
    shipMaterial.uniforms.uPointSize.value = pointPx * pixelRatio;
    markerMaterial.uniforms.uPointSize.value = MARKER_PX * pixelRatio;
    ring.material.uniforms.uPointSize.value = SELECTION_RING_PX * pixelRatio;
    coverageUniforms.uHatchSpacing.value = HATCH_SPACING_PX * pixelRatio;
    coverageUniforms.uHatchHalfWidth.value = (HATCH_LINE_PX * pixelRatio) / 2;
    // The Planet tier: the density field takes over from the ship dots as the camera climbs.
    const planetShare = readPlanetShare(distance);
    shipMaterial.uniforms.uOpacity.value = 1 - planetShare;
    ships.visible = planetShare < 1;
    densityMaterial.uniforms.uOpacity.value = planetShare * DENSITY_ALPHA;
    densityMaterial.uniforms.uMinPx.value = DENSITY_DOT_MIN_PX * pixelRatio;
    densityMaterial.uniforms.uMaxPx.value = DENSITY_DOT_MAX_PX * pixelRatio * Math.min(2, (HOME_DISTANCE - 1) / Math.max(0.02, distance - 1));
    densityPoints.visible = hasDensity && planetShare > 0;
    outlineMaterial.uniforms.uOpacity.value = (1 - planetShare) * REGION_OUTLINE_ALPHA;
    outlines.visible = planetShare < 1;
    isSignalRunning = lineLayer?.update({ nowMs: now, cameraPosition: camera.position, homeDistance: HOME_DISTANCE, isCalm, pixelRatio }) ?? false;
    rippleMaterial.uniforms.uPointSize.value = RIPPLE_PX * pixelRatio;
    rippleMaterial.uniforms.uPhase.value = (now % RIPPLE_PERIOD_MS) / RIPPLE_PERIOD_MS;
    isRippleRunning = !isCalm && rippleDirections.some((direction) => direction.dot(camera.position) > RIPPLE_LIFT);
    renderer.render(scene, camera);
    if (shouldPlaceLabels) {
      const showsSeaLabels = planetShare >= SEA_LABEL_MIN_SHARE;
      for (const { label, direction } of seaLabels.values()) label.object.visible = showsSeaLabels && direction.dot(camera.position) > 1;
      labelRenderer.render(labelScene, camera);
      if (showsSeaLabels) hideOverlappingLabels(labelRenderer.domElement);
    }
    if (hasCameraMoved || isFirstFrame) {
      isFirstFrame = false;
      const centre = readLongitudeLatitude(camera.position.x, camera.position.y, camera.position.z);
      onViewChange({ tier: readDistanceTier(distance), longitude: centre.longitude, latitude: centre.latitude });
    }
  }
  renderer
    .compileAsync(scene, camera)
    .catch((error: unknown) => console.error(`[createGlobeViewer] shader compile failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      if (!isDisposed) frameHandle = requestAnimationFrame(renderFrame);
    });

  return {
    ok: true,
    value: {
      setFramePair(nextPair) {
        pair = nextPair;
        shipGeometry.dispose();
        if (nextPair) {
          shipGeometry.setAttribute("position", new THREE.BufferAttribute(nextPair.fromPositions, 3));
          shipGeometry.setAttribute("aFrom", new THREE.BufferAttribute(nextPair.fromPositions, 3));
          shipGeometry.setAttribute("aTo", new THREE.BufferAttribute(nextPair.toPositions, 3));
          shipGeometry.setAttribute("aFromPresence", new THREE.BufferAttribute(nextPair.fromPresence, 1));
          shipGeometry.setAttribute("aToPresence", new THREE.BufferAttribute(nextPair.toPresence, 1));
          shipGeometry.setDrawRange(0, nextPair.shipCount);
        } else {
          shipGeometry.setDrawRange(0, 0);
        }
        placeRing();
        markDirty();
      },
      setBlend(nextBlend) {
        const clamped = Math.min(1, Math.max(0, nextBlend));
        if (clamped === blend) return;
        blend = clamped;
        shipMaterial.uniforms.uBlend.value = clamped;
        placeRing();
        markDirty();
      },
      setSelectedShip(mmsi) {
        selectedMmsi = mmsi;
        placeRing();
        markDirty();
      },
      setLines(lines) {
        if (lineLayer) {
          scene.remove(lineLayer.object);
          lineLayer.dispose();
        }
        lineLayer = createGlobeLineLayer(lines);
        lineLayer.setSelectedLine(selectedLineId);
        lineLayer.setResolution(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        scene.add(lineLayer.object);
        markDirty();
      },
      setSelectedLine(lineId) {
        selectedLineId = lineId;
        lineLayer?.setSelectedLine(lineId);
        markDirty();
      },
      setCoverage(mask) {
        if (mask === null) {
          coverageUniforms.uHasCoverage.value = 0;
        } else {
          coverageData.set(mask.subarray(0, coverageData.length));
          coverageTexture.needsUpdate = true;
          coverageUniforms.uHasCoverage.value = 1;
        }
        markDirty();
      },
      focusShip(mmsi, distance = FOCUS_DISTANCE) {
        const shipIndex = findShipIndex(mmsi);
        if (shipIndex === -1) return false;
        const shipVector = new THREE.Vector3();
        readShip(shipIndex, shipVector);
        void startCameraMove(shipVector.normalize().multiplyScalar(Math.max(MIN_DISTANCE, distance)), FOCUS_MOVE_MS, easeOutCubic, isCalm);
        return true;
      },
      setRightInset(insetPx) {
        const nextInsetPx = Math.max(0, insetPx);
        if (nextInsetPx === rightInsetPx) return;
        rightInsetPx = nextInsetPx;
        resize();
      },
      setIncidents(nextMarkers) {
        markers = nextMarkers;
        placeMarkers();
      },
      setSelectedIncident(slug) {
        selectedIncident = slug;
        placeMarkers();
      },
      flyTo({ longitude, latitude, distance = MIN_DISTANCE, durationMs = DIVE_MOVE_MS, isJump = false }) {
        // The dive flies on a software renderer too (it is one deliberate move, drawn as fast as the renderer can);
        // only reduced motion turns it into a jump.
        return startCameraMove(cameraPositionFor(longitude, latitude, Math.max(MIN_DISTANCE, distance)), durationMs, easeStandard, prefersReducedMotion || isJump);
      },
      setDensity(density) {
        densityGeometry.dispose();
        hasDensity = density !== null && density.cellCount > 0;
        if (density && hasDensity) {
          const lifted = density.positions.map((coordinate) => coordinate * DENSITY_LIFT);
          densityGeometry.setAttribute("position", new THREE.BufferAttribute(lifted, 3));
          densityGeometry.setAttribute("aCount", new THREE.BufferAttribute(density.counts, 1));
          densityGeometry.setDrawRange(0, density.cellCount);
        } else {
          densityGeometry.setDrawRange(0, 0);
        }
        markDirty();
      },
      setSeaLabels(labels) {
        const nextLabels = new Map<string, { label: StackedLabel; direction: THREE.Vector3 }>();
        const unitVector = new Float32Array(3);
        labels.forEach((seaLabel, index) => {
          let entry = seaLabels.get(seaLabel.name);
          if (!entry) {
            const label = makeStackedLabel(seaLabel.name, seaLabel.note);
            label.object.element.dataset.testid = "live-sea-label";
            writeUnitVector(seaLabel.longitude, seaLabel.latitude, unitVector, 0);
            const direction = new THREE.Vector3(unitVector[0], unitVector[1], unitVector[2]);
            label.object.position.copy(direction).multiplyScalar(DENSITY_LIFT);
            labelScene.add(label.object);
            entry = { label, direction };
          }
          entry.label.setNote(seaLabel.note);
          // Busiest first: hideOverlappingLabels keeps the lower rank where two overlap.
          entry.label.object.element.dataset.labelRank = String(index);
          nextLabels.set(seaLabel.name, entry);
        });
        seaLabels.forEach((entry, name) => {
          if (!nextLabels.has(name)) labelScene.remove(entry.label.object);
        });
        seaLabels = nextLabels;
        markDirty();
      },
      setRegionOutlines(boxes) {
        outlineGeometry.dispose();
        const segments = boxes.map((box) => buildBoxOutline(box, REGION_OUTLINE_LIFT));
        const merged = new Float32Array(segments.reduce((sum, segment) => sum + segment.length, 0));
        let offset = 0;
        for (const segment of segments) {
          merged.set(segment, offset);
          offset += segment.length;
        }
        outlineGeometry.setAttribute("position", new THREE.BufferAttribute(merged, 3));
        markDirty();
      },
      setRipples(points) {
        rippleGeometry.dispose();
        const positions = new Float32Array(points.length * 3);
        points.forEach((point, index) => writeUnitVector(point.longitude, point.latitude, positions, index * 3));
        rippleDirections = points.map((_point, index) => new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]));
        rippleGeometry.setAttribute("position", new THREE.BufferAttribute(positions.map((coordinate) => coordinate * RIPPLE_LIFT), 3));
        rippleGeometry.setDrawRange(0, points.length);
        markDirty();
      },
      readCentre() {
        return readLongitudeLatitude(camera.position.x, camera.position.y, camera.position.z);
      },
      resetView() {
        stopCameraMove();
        camera.position.copy(cameraPositionFor(HOME_LONGITUDE, HOME_LATITUDE, HOME_DISTANCE));
        controls.target.set(0, 0, 0);
        controls.update();
        markDirty();
      },
      dispose() {
        isDisposed = true;
        cancelAnimationFrame(frameHandle);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        controls.removeEventListener("change", markDirty);
        controls.removeEventListener("start", stopCameraMove);
        controls.dispose();
        scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line)) return;
          child.geometry.dispose();
          const materials: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        });
        landTexture.dispose();
        detailTexture.dispose();
        coverageTexture.dispose();
        lineLayer?.dispose();
        seaLabels.forEach((entry) => labelScene.remove(entry.label.object));
        labelRenderer.domElement.remove();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      },
    },
  };
}
