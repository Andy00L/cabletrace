import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { detectRendererKind, type RendererKind } from "@/lib/diagnostics/webgl-renderer";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import type { FramePair } from "@/lib/globe/frame-pairing";
import type { LandPolygons } from "@/lib/globe/land-polygons";
import { COVERAGE_HEIGHT, COVERAGE_WIDTH } from "@/lib/globe/coverage";
import { createLandTexture, WORLD_BOX, type LandBox } from "@/lib/globe/land-texture";
import { writeUnitVector } from "@/lib/globe/sphere";
import { createGlobeLineLayer, type GlobeLineLayer } from "@/lib/globe/globe-lines";
import type { GlobeLine } from "@/lib/globe/world-lines";
import type { Result } from "@/lib/result";

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
const HATCH_LINE_PX = 1.2;

export type GlobeViewer = {
  /** The two frames to blend between, or null while none is loaded. */
  setFramePair: (pair: FramePair | null) => void;
  /** Where the moment sits between the pair's frames, 0 to 1. */
  setBlend: (blend: number) => void;
  setSelectedShip: (mmsi: number | null) => void;
  /** The cables and pipelines to draw (world and watched, src/lib/globe/world-lines.ts); replaces any drawn before. */
  setLines: (lines: readonly GlobeLine[]) => void;
  /** Where the feeds heard ships (src/lib/globe/coverage.ts, renderCoverageMask), or null to hatch nothing. */
  setCoverage: (mask: Uint8Array | null) => void;
  /** Flies the camera over a ship of the current pair; false when the pair does not hold it. */
  focusShip: (mmsi: number) => boolean;
  /** Width of a panel floating over the right edge (CSS px); the globe centres on what is left. */
  setRightInset: (insetPx: number) => void;
  resetView: () => void;
  dispose: () => void;
};

type GlobeViewerOptions = {
  container: HTMLElement;
  land: LandPolygons;
  /** Called with the MMSI of a clicked ship, or null when a click lands on no ship. */
  onShipPick: (mmsi: number | null) => void;
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

// Colors are written as given (sRGB hex), so the ship tone matches the token exactly.
const SHIP_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vPresence;
  void main() {
    float edge = 1.0 - smoothstep(0.36, 0.5, length(gl_PointCoord - 0.5));
    float alpha = edge * vPresence;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
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

function cameraPositionFor(longitude: number, latitude: number, distance: number): THREE.Vector3 {
  const direction = new Float32Array(3);
  writeUnitVector(longitude, latitude, direction, 0);
  return new THREE.Vector3(direction[0], direction[1], direction[2]).multiplyScalar(distance);
}

/** Builds the globe inside `container` and starts drawing on demand. Never throws. */
export function createGlobeViewer(options: GlobeViewerOptions): Result<GlobeViewer> {
  const { container, land, onShipPick, prefersReducedMotion } = options;
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

  const shipGeometry = new THREE.BufferGeometry();
  const shipMaterial = new THREE.ShaderMaterial({
    uniforms: { uBlend: { value: 0 }, uPointSize: { value: SHIP_POINT_PX }, uLift: { value: SHIP_LIFT }, uColor: { value: toRawColor(WEBGL_COLORS.ship) } },
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

  let pair: FramePair | null = null;
  let blend = 0;
  let selectedMmsi: number | null = null;
  let isDirty = true;
  const markDirty = () => {
    isDirty = true;
  };
  controls.addEventListener("change", markDirty);
  let cameraMove: { from: THREE.Vector3; to: THREE.Vector3; startedAt: number } | null = null;
  // Grabbing the globe ends a scripted flight.
  const stopCameraMove = () => {
    cameraMove = null;
  };
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
    lineLayer?.setResolution(width, height);
    markDirty();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // Clicks pick the nearest visible ship; a press that turns into a drag rotates the globe and picks nothing.
  let pressStart: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    pressStart = { x: event.clientX, y: event.clientY };
  };
  const pickVector = new THREE.Vector3();
  const onPointerUp = (event: PointerEvent) => {
    if (!pressStart || Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > CLICK_SLOP_PX) {
      pressStart = null;
      return;
    }
    pressStart = null;
    if (!pair) {
      onShipPick(null);
      return;
    }
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    let nearestMmsi: number | null = null;
    let nearestDistance = PICK_RADIUS_PX;
    for (let shipIndex = 0; shipIndex < pair.shipCount; shipIndex += 1) {
      if (readShip(shipIndex, pickVector) < 0.5) continue;
      // A point on the unit sphere faces the camera when its dot product with the camera position exceeds 1.
      if (pickVector.dot(camera.position) <= SHIP_LIFT) continue;
      pickVector.project(camera);
      const screenX = ((pickVector.x + 1) / 2) * bounds.width;
      const screenY = ((1 - pickVector.y) / 2) * bounds.height;
      const distance = Math.hypot(screenX - pointerX, screenY - pointerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestMmsi = pair.mmsi[shipIndex] ?? null;
      }
    }
    onShipPick(nearestMmsi);
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  let frameHandle = 0;
  let isDisposed = false;
  const moveDirection = new THREE.Vector3();
  function stepCameraMove(now: number): boolean {
    if (!cameraMove) return false;
    const amount = Math.min(1, (now - cameraMove.startedAt) / FOCUS_MOVE_MS);
    // Ease out cubic, as the seabed's camera moves do.
    const eased = 1 - (1 - amount) ** 3;
    const distance = cameraMove.from.length() + (cameraMove.to.length() - cameraMove.from.length()) * eased;
    moveDirection.copy(cameraMove.from).normalize().lerp(cameraMove.to.clone().normalize(), eased).normalize();
    camera.position.copy(moveDirection).multiplyScalar(distance);
    if (amount >= 1) cameraMove = null;
    return true;
  }

  // True while a watched cable's light runs on the side facing the camera: the globe then draws every frame.
  let isSignalRunning = false;
  function renderFrame(now: number) {
    frameHandle = requestAnimationFrame(renderFrame);
    const isFlying = stepCameraMove(now);
    const hasCameraMoved = controls.update() || isFlying;
    if (!isDirty && !hasCameraMoved && !isSignalRunning) return;
    isDirty = false;
    const distance = camera.position.length();
    controls.rotateSpeed = Math.max(0.05, Math.min(1, (distance - 1) * ROTATE_SPEED_PER_UNIT));
    const pixelRatio = renderer.getPixelRatio();
    const pointPx = Math.max(SHIP_POINT_MIN_PX, Math.min(SHIP_POINT_MAX_PX, SHIP_POINT_PX * ((HOME_DISTANCE - 1) / Math.max(0.02, distance - 1)) ** 0.5));
    shipMaterial.uniforms.uPointSize.value = pointPx * pixelRatio;
    ring.material.uniforms.uPointSize.value = SELECTION_RING_PX * pixelRatio;
    coverageUniforms.uHatchSpacing.value = HATCH_SPACING_PX * pixelRatio;
    coverageUniforms.uHatchHalfWidth.value = (HATCH_LINE_PX * pixelRatio) / 2;
    isSignalRunning = lineLayer?.update({ nowMs: now, cameraPosition: camera.position, homeDistance: HOME_DISTANCE, isCalm, pixelRatio }) ?? false;
    renderer.render(scene, camera);
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
        lineLayer.setResolution(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        scene.add(lineLayer.object);
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
      focusShip(mmsi) {
        const shipIndex = findShipIndex(mmsi);
        if (shipIndex === -1) return false;
        const shipVector = new THREE.Vector3();
        readShip(shipIndex, shipVector);
        const destination = shipVector.normalize().multiplyScalar(FOCUS_DISTANCE);
        if (isCalm) {
          camera.position.copy(destination);
          controls.update();
        } else {
          cameraMove = { from: camera.position.clone(), to: destination, startedAt: performance.now() };
        }
        markDirty();
        return true;
      },
      setRightInset(insetPx) {
        const nextInsetPx = Math.max(0, insetPx);
        if (nextInsetPx === rightInsetPx) return;
        rightInsetPx = nextInsetPx;
        resize();
      },
      resetView() {
        cameraMove = null;
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
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      },
    },
  };
}
