import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { drawAfterWater, keepDataColorExact } from "@/lib/render/data-colors";
import { clampValue, createSeededRandom, interpolate, sampleFractalNoise, smoothStep } from "@/lib/seabed/math";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";
import type { ChainShape } from "@/lib/ships/anchor-chain";
import { makeLabel, makeStackedLabel } from "@/lib/seabed/scene/labels";
import { buildAnchorModel, buildStudLinkGeometry, createAnchorSteelMaterial } from "@/lib/seabed/scene/models";
import { SCENE_SCALES } from "@/lib/seabed/scene-scales";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { createCableServingTexture } from "@/lib/seabed/scene/seabed-lines";
import { createRayTexture } from "@/lib/seabed/scene/textures";
import type { ScenePoint } from "@/lib/seabed/terrain";

// The close-up of the cut: 1 unit is 2 m and the patch is 320 m square, aligned so the vessel's track runs along +x.
// The surveyed slope stays at true scale; only drawn-in detail (ripples, furrow) is sized up to read.
//
// The cut plays out with the replay's clock, from six minutes before the cut to two minutes after it, so it scrubs
// and every frame is a pure function of the moment (the lookdev harness needs that; reduced motion steps through the
// same beats as stills): the anchor drags in along its furrow raising silt; a fluke catches the cable; the cable is
// pulled into a bight under tension; the armour wires part, the copper core shows and the two ends spring apart; the
// silt settles. The timing of the beats inside the sequence is illustrated, as the whole close-up is: no source times
// them, so the sequence is compressed to read (the scale note says the close-up is illustrated).
const METRES_PER_UNIT = 2;
const PATCH_SIZE_UNITS = 160;
const PATCH_SEGMENTS = 240;
const ROCK_COUNT = 280;
const PLUME_COUNT = 220;
// Stud links of about 0.5 m, drawn at the anchor's scale (so one every 0.5 units), from the anchor out of the patch.
const CHAIN_LINKS = 260;
const CHAIN_LINK_PITCH_UNITS = (0.5 * SCENE_SCALES.closeUpAnchorScale) / METRES_PER_UNIT;
// Links on the sand sit this far (units) above it so the relief does not swallow them.
const CHAIN_SAND_CLEARANCE = 0.12;
const CHAIN_DROP_METRES = 4;
const LIGHT_SHAFT_COUNT = 7;
// Where the anchor comes to rest, units past the cable along the track, and how far its pivot sits above the sand.
// It lies rolled onto one side, as a dragged anchor does: one fluke dug in, the other blade in view.
const ANCHOR_X = 11;
const ANCHOR_LIFT = 1.35;
const ANCHOR_ROLL_RADIANS = 0.8;
// Cable radius in units (0.76 m): drawn thicker than life so it reads at this scale; no source gives the real
// diameter, so the disclosure says "thicker than life" rather than a factor. It lies a third buried in the sediment.
const CABLE_RADIUS = 0.38;
const CABLE_CENTRE_ABOVE_SAND = 0.62 * CABLE_RADIUS;
// The anchor model is built in metres; this many units per metre draws it at the disclosed scale.
const ANCHOR_UNITS_PER_METRE = SCENE_SCALES.closeUpAnchorScale / METRES_PER_UNIT;
// Half of the gap between the two torn ends once they have sprung apart, in units.
const CABLE_GAP = 0.9;
// Fixed seed so the illustrated detail is identical on every load (the Estlink 2 cut date).
const DETAIL_SEED = 20241225;
// The cable's thin tracer: its data colour along the top, a fixed number of device pixels wide.
const TRACER_WIDTH_PX = 2;
// The contact shadow under the cable: this many cable radii wide, this dark at its middle.
const CONTACT_SHADOW_RADII = 3.2;
const CONTACT_SHADOW_OPACITY = 0.45;

/**
 * The beats of the cut, in seconds from the cut (negative before it): the anchor enters the patch, reaches the cable
 * and catches it, the cable parts, its ends settle, the silt has settled.
 */
export const CUT_SEQUENCE_SECONDS = { enter: -360, catch: -120, part: -10, settled: 30, siltSettled: 120 } as const;
// Where the anchor stands at the beats (units along the track): entering the patch, at the cable with a fluke under it.
const ANCHOR_ENTER_X = -26;
const ANCHOR_AT_CABLE_X = -1.6;
// How far the fluke drags the cable into a bight before it parts (units along the track) and the bight's half length.
const BIGHT_MAX_UNITS = 6.5;
const BIGHT_HALF_LENGTH_UNITS = 7;
// After parting each end recoils past its rest and settles, a damped spring: period and decay (seconds).
const RECOIL_PERIOD_SECONDS = 9;
const RECOIL_DECAY_SECONDS = 7;
// The bend each torn end keeps where the anchor dragged it (units), the static scene's shape after the cut.
const RESIDUAL_BEND_UNITS = 5.5;
// The cut's name floats this far over the gap (units).
const CUT_LABEL_LIFT = new THREE.Vector3(0, 2.4, 0);

export type CloseUpScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Draws the cut sequence at a replay moment (ms) and runs the ambient light and silt. */
  update: (atMs: number, nowSeconds: number, deltaSeconds: number) => void;
  setIllustrated: (isIllustrated: boolean) => void;
  resetCamera: () => void;
};

type CloseUpOptions = {
  domElement: HTMLElement;
  sampleElevationMetres: (sceneX: number, sceneZ: number) => number;
  cutScene: ScenePoint;
  /** The moment of the cut the close-up shows (ms since the epoch). */
  cutAtMs: number;
  trackDirection: ScenePoint;
  cableDirection: ScenePoint;
  cableLabel: string;
  /** Reflections for the steel (the overview's room environment); without one, metal renders near black. */
  environment: THREE.Texture | null;
  /** The sky HDRI for the steel's reflections on the GPU tiers, or null. */
  sky: THREE.Texture | null;
  softDot: THREE.Texture;
  /** The renderer's materials for custom shading and particles (src/lib/render/scene-renderer.ts). */
  kit: SceneMaterialKit;
  prefersReducedMotion: boolean;
  /** The chain's shape at the cut from the anchor model (metres), or null where the model has none. */
  chainShape: ChainShape | null;
};

/** What the sequence shows at a moment: where the anchor is, how far the cable is pulled, whether and how far it parted. */
type CutState = { anchorX: number; bight: number; isParted: boolean; endGap: number; endBend: number; siltRise: number };

function easeInOut(amount: number): number {
  const clamped = clampValue(amount, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/** The sequence's state `seconds` from the cut. */
function readCutState(seconds: number): CutState {
  const beats = CUT_SEQUENCE_SECONDS;
  const isParted = seconds >= beats.part;
  let anchorX: number;
  if (seconds < beats.catch) anchorX = interpolate(ANCHOR_ENTER_X, ANCHOR_AT_CABLE_X, easeInOut((seconds - beats.enter) / (beats.catch - beats.enter)));
  else if (!isParted) anchorX = ANCHOR_AT_CABLE_X + 0.25 * ((seconds - beats.catch) / (beats.part - beats.catch));
  // Released, the anchor lurches forward and comes to rest.
  else anchorX = interpolate(ANCHOR_AT_CABLE_X + 0.25, ANCHOR_X, 1 - Math.exp(-(seconds - beats.part) / 6));
  // The bight builds as the fluke drags the cable, tension rising toward the moment it parts.
  const bight = isParted ? 0 : BIGHT_MAX_UNITS * easeInOut((seconds - beats.catch) / (beats.part - beats.catch)) ** 1.4;
  // Parted, each end springs back past its rest and settles: a damped oscillation around the residual bend.
  const sinceParting = Math.max(0, seconds - beats.part);
  const recoil = Math.exp(-sinceParting / RECOIL_DECAY_SECONDS) * Math.cos((2 * Math.PI * sinceParting) / RECOIL_PERIOD_SECONDS);
  const endBend = isParted ? RESIDUAL_BEND_UNITS + (BIGHT_MAX_UNITS - RESIDUAL_BEND_UNITS) * recoil : 0;
  const endGap = isParted ? CABLE_GAP * (1 - Math.exp(-sinceParting / 2)) * (1 + 0.35 * recoil) : 0;
  // Silt rises behind the dragging anchor, billows when the cable parts and settles over two minutes.
  const siltRise = seconds < beats.enter ? 0 : seconds < beats.part ? 0.6 + 0.4 * easeInOut((seconds - beats.catch) / (beats.part - beats.catch)) : Math.max(0, 1 - (seconds - beats.part) / (beats.siltSettled - beats.part));
  return { anchorX, bight, isParted, endGap, endBend, siltRise };
}

export function buildCloseUp(options: CloseUpOptions): CloseUpScene {
  const { sampleElevationMetres, cutScene, trackDirection, cableDirection, kit, prefersReducedMotion } = options;
  // One caustic clock for this close-up's seabed and rocks.
  const caustics = kit.createCaustics();
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(SCENE_COLORS.closeUpFog);
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor, 0.0125);
  scene.environment = options.environment;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(SCENE_COLORS.closeUpSky, SCENE_COLORS.closeUpGround, 1.25));
  const sunLight = new THREE.DirectionalLight(SCENE_COLORS.skyLight, 1.7);
  sunLight.position.set(26, 80, 18);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 20, far: 170 });
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);

  const perpendicular = { x: -trackDirection.z, z: trackDirection.x };
  const kmPerUnit = METRES_PER_UNIT / 1000;
  const toOverview = (localX: number, localZ: number): ScenePoint => ({
    x: cutScene.x + (localX * trackDirection.x + localZ * perpendicular.x) * kmPerUnit,
    z: cutScene.z + (localX * trackDirection.z + localZ * perpendicular.z) * kmPerUnit,
  });
  const cutElevation = sampleElevationMetres(cutScene.x, cutScene.z);
  const cableAngle = Math.atan2(
    cableDirection.x * trackDirection.z - cableDirection.z * trackDirection.x,
    cableDirection.x * trackDirection.x + cableDirection.z * trackDirection.z,
  );
  const cableLocal = { x: Math.cos(cableAngle), z: -Math.sin(cableAngle) };

  /** The furrow's shape (units, up), whole: the trench and berms behind the anchor's resting place and the mound ahead. */
  function computeFurrowShape(localX: number, localZ: number): { trench: number; mound: number } {
    const wobble = (sampleFractalNoise(localX * 0.05, 3.3, 2) - 0.5) * 1.6;
    const across = localZ - wobble;
    const trench = -1.5 * Math.exp(-((across / 1.7) ** 2)) + 0.5 * (Math.exp(-(((across - 3.4) / 1.3) ** 2)) + Math.exp(-(((across + 3.4) / 1.3) ** 2)));
    const mound = 0.45 * Math.exp(-(((localX - 2.8) / 1.3) ** 2) - (across / 2.6) ** 2);
    return { trench, mound };
  }

  /** The furrow ploughed so far: behind an anchor standing at `anchorX`, with its mound pushed up just ahead of it. */
  function computeFurrowOffset(localX: number, localZ: number, anchorX: number): number {
    const shape = computeFurrowShape(localX, localZ);
    const behindAnchor = smoothStep(anchorX + 1.5, anchorX - 2, localX) * smoothStep(ANCHOR_ENTER_X - 10, ANCHOR_ENTER_X + 4, localX);
    const moundShift = computeFurrowShape(localX - anchorX, localZ).mound;
    return shape.trench * behindAnchor + moundShift * (anchorX > ANCHOR_ENTER_X - 5 ? 1 : 0);
  }

  function computeBaseHeight(localX: number, localZ: number, isIllustrated: boolean): number {
    const overview = toOverview(localX, localZ);
    const baseHeight = (sampleElevationMetres(overview.x, overview.z) - cutElevation) / METRES_PER_UNIT;
    if (!isIllustrated) return baseHeight;
    const relief = (sampleFractalNoise(localX * 0.045 + 11, localZ * 0.045 - 7, 4) - 0.5) * 2.4;
    const rippleWarp = sampleFractalNoise(localX * 0.03, localZ * 0.03, 2) * 6;
    const ripples = Math.sin((localX * 0.55 + localZ * 0.82) * 1.6 + rippleWarp) * 0.18;
    return baseHeight + relief + ripples;
  }

  // The anchor's place drives the illustrated ground: the furrow reaches as far as the anchor has dragged.
  let anchorXNow = ANCHOR_X;
  function computeHeight(localX: number, localZ: number, isIllustrated: boolean): number {
    const base = computeBaseHeight(localX, localZ, isIllustrated);
    return isIllustrated ? base + computeFurrowOffset(localX, localZ, anchorXNow) : base;
  }

  /** The patch, and for the illustrated one the vertices in the furrow's band, so the furrow can grow without a rebuild. */
  function buildPatch(isIllustrated: boolean): { mesh: THREE.Mesh; regrowFurrow: (anchorX: number) => void } {
    const geometry = new THREE.PlaneGeometry(PATCH_SIZE_UNITS, PATCH_SIZE_UNITS, PATCH_SEGMENTS, PATCH_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const sand = new THREE.Color(SCENE_COLORS.sand);
    const mud = new THREE.Color(SCENE_COLORS.mud);
    const trenchFloor = new THREE.Color(SCENE_COLORS.trenchFloor);
    const berm = new THREE.Color(SCENE_COLORS.berm);
    const measuredTone = new THREE.Color(SCENE_COLORS.measuredSeabed);
    const vertexColor = new THREE.Color();
    const baseHeights = new Float32Array(positions.count);
    const baseColors = new Float32Array(positions.count * 3);
    const bandVertices: number[] = [];
    for (let index = 0; index < positions.count; index += 1) {
      const localX = positions.getX(index);
      const localZ = positions.getZ(index);
      baseHeights[index] = computeBaseHeight(localX, localZ, isIllustrated);
      if (isIllustrated) {
        const mudAmount = smoothStep(0.35, 0.7, sampleFractalNoise(localX * 0.06 + 40, localZ * 0.06, 3));
        vertexColor.copy(sand).lerp(mud, mudAmount * 0.8);
        if (Math.abs(localZ) < 9) bandVertices.push(index);
      } else {
        vertexColor.copy(measuredTone);
      }
      vertexColor.toArray(baseColors, index * 3);
      vertexColor.toArray(colors, index * 3);
      positions.setY(index, baseHeights[index] ?? 0);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const colorAttribute = geometry.getAttribute("color");
    const material = caustics.createMaterial({ vertexColors: true, roughness: 1, metalness: 0 }, isIllustrated ? 0.45 : 0.2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    let grownTo = Number.NaN;
    function regrowFurrow(anchorX: number) {
      if (!isIllustrated || anchorX === grownTo) return;
      grownTo = anchorX;
      for (const index of bandVertices) {
        const localX = positions.getX(index);
        const localZ = positions.getZ(index);
        const furrow = computeFurrowOffset(localX, localZ, anchorX);
        positions.setY(index, (baseHeights[index] ?? 0) + furrow);
        vertexColor.fromArray(baseColors, index * 3);
        if (furrow < 0) vertexColor.lerp(trenchFloor, clampValue(-furrow / 1.4, 0, 1));
        else vertexColor.lerp(berm, clampValue(furrow / 0.6, 0, 1) * 0.6);
        colorAttribute.setXYZ(index, vertexColor.r, vertexColor.g, vertexColor.b);
      }
      positions.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    if (!isIllustrated) geometry.computeVertexNormals();
    return { mesh, regrowFurrow };
  }

  const illustratedGroup = new THREE.Group();
  const measuredGroup = new THREE.Group();
  const illustratedPatch = buildPatch(true);
  illustratedPatch.regrowFurrow(ANCHOR_X);
  illustratedGroup.add(illustratedPatch.mesh);
  measuredGroup.add(buildPatch(false).mesh);
  scene.add(illustratedGroup, measuredGroup);

  const random = createSeededRandom(DETAIL_SEED);
  /** A point on the cable's centreline `along` units from the cut, pulled `pull` units along the track by the fluke. */
  const cablePoint = (along: number, pull: number, isIllustrated: boolean, target = new THREE.Vector3()) => {
    const localX = along * cableLocal.x + pull * Math.exp(-((along / BIGHT_HALF_LENGTH_UNITS) ** 2));
    const localZ = along * cableLocal.z;
    return target.set(localX, computeHeight(localX, localZ, isIllustrated) + CABLE_CENTRE_ABOVE_SAND, localZ);
  };
  const servingTexture = createCableServingTexture();
  const servingMaterial = new THREE.MeshStandardMaterial({ map: servingTexture, roughness: 0.78, metalness: 0.05, bumpMap: servingTexture, bumpScale: 0.6 });
  const copperMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.copper, roughness: 0.3, metalness: 0.9, emissive: SCENE_COLORS.copperGlow, emissiveIntensity: 0.25 });
  const steelMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.steel, roughness: 0.35, metalness: 0.75 });
  const insulationMaterial = new THREE.MeshStandardMaterial({ color: "#1C1C1E", roughness: 0.55, metalness: 0 });
  const contactShadowMaterial = new THREE.MeshBasicMaterial({ color: SCENE_COLORS.contactShadow, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  /** One drawn piece of cable: its tube, the tracer along its top and the contact shadow under it, rebuilt on demand. */
  function createCablePiece() {
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), servingMaterial);
    tube.castShadow = true;
    tube.receiveShadow = true;
    const tracerGeometry = new LineGeometry();
    const tracer = drawAfterWater(kit.createScreenLine(tracerGeometry, { color: WEBGL_COLORS.cable, widthPx: TRACER_WIDTH_PX, hasVertexColors: false, opacity: 1 }));
    if (!Array.isArray(tracer.material)) keepDataColorExact(tracer.material);
    tracer.frustumCulled = false;
    const shadow = new THREE.Mesh(new THREE.BufferGeometry(), contactShadowMaterial);
    shadow.renderOrder = 1;
    const group = new THREE.Group();
    group.add(tube, tracer, shadow);
    let curve: THREE.CatmullRomCurve3 | null = null;
    function rebuild(points: THREE.Vector3[]) {
      curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      tube.geometry.dispose();
      tube.geometry = new THREE.TubeGeometry(curve, points.length * 2, CABLE_RADIUS, 14, false);
      if (servingTexture) servingTexture.repeat.set(curve.getLength() / 1.2, 1);
      tracerGeometry.setPositions(points.flatMap((point) => [point.x, point.y + CABLE_RADIUS * 1.02, point.z]));
      shadow.geometry.dispose();
      shadow.geometry = buildContactShadow(points);
    }
    return { group, rebuild, readCurve: () => curve };
  }

  /** A strip on the sand under the cable, dark in the middle and fading to nothing at its edges. */
  function buildContactShadow(points: THREE.Vector3[]): THREE.BufferGeometry {
    const halfWidth = (CONTACT_SHADOW_RADII * CABLE_RADIUS) / 2;
    const lanes = [-1, -0.4, 0, 0.4, 1];
    const laneOpacities = [0, 0.7, 1, 0.7, 0];
    const positions: number[] = [];
    const colors: number[] = [];
    points.forEach((point, index) => {
      const next = points[Math.min(points.length - 1, index + 1)] ?? point;
      const previous = points[Math.max(0, index - 1)] ?? point;
      const directionX = next.x - previous.x;
      const directionZ = next.z - previous.z;
      const length = Math.hypot(directionX, directionZ) || 1;
      lanes.forEach((lane, laneIndex) => {
        const pointX = point.x - (directionZ / length) * halfWidth * lane;
        const pointZ = point.z + (directionX / length) * halfWidth * lane;
        positions.push(pointX, computeHeight(pointX, pointZ, true) + 0.03, pointZ);
        colors.push(1, 1, 1, CONTACT_SHADOW_OPACITY * (laneOpacities[laneIndex] ?? 0));
      });
    });
    const indices: number[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      for (let lane = 0; lane < lanes.length - 1; lane += 1) {
        const current = index * lanes.length + lane;
        const next = current + lanes.length;
        indices.push(current, next, current + 1, current + 1, next, next + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    return geometry;
  }

  /** The cable's centreline from `fromAlong` to `toAlong`, every 0.8 units, pulled `pull` units into a bight. */
  function sampleCable(fromAlong: number, toAlong: number, pull: number, isIllustrated: boolean): THREE.Vector3[] {
    const steps = Math.max(2, Math.ceil(Math.abs(toAlong - fromAlong) / 0.8));
    return Array.from({ length: steps + 1 }, (_slot, step) => cablePoint(interpolate(fromAlong, toAlong, step / steps), pull, isIllustrated));
  }

  // A torn end: the armour wires splayed back, the black insulation, the lead sheath's grey and the copper core pushing
  // out of it, the layers of an HVDC cable as they show at a break.
  function buildTornEnd(): THREE.Group {
    const group = new THREE.Group();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const layers: [number, number, THREE.Material][] = [
      [CABLE_RADIUS * 0.82, 0.3, steelMaterial],
      [CABLE_RADIUS * 0.66, 0.5, insulationMaterial],
      [CABLE_RADIUS * 0.48, 0.85, copperMaterial],
    ];
    layers.forEach(([radius, length, material]) => {
      const layer = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.05, length, 18), material);
      layer.position.y = length / 2;
      layer.castShadow = true;
      group.add(layer);
    });
    for (let wire = 0; wire < 14; wire += 1) {
      const angle = (wire / 14) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const direction = upAxis.clone().multiplyScalar(0.75).addScaledVector(radial, 0.5 + random() * 0.4).normalize();
      const length = 0.7 + random() * 0.8;
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 6), steelMaterial);
      strand.quaternion.setFromUnitVectors(upAxis, direction);
      strand.position.copy(radial.multiplyScalar(CABLE_RADIUS * 0.85)).addScaledVector(direction, length / 2);
      strand.castShadow = true;
      group.add(strand);
    }
    return group;
  }
  /** Stands a torn end on a piece's end, pointing out of it. */
  function placeTornEnd(end: THREE.Group, curve: THREE.CatmullRomCurve3 | null, atStart: boolean) {
    if (!curve) return;
    const outward = curve.getTangentAt(atStart ? 0 : 1).clone().multiplyScalar(atStart ? -1 : 1);
    end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    end.position.copy(curve.getPointAt(atStart ? 0 : 1));
  }

  const intactCable = createCablePiece();
  const westCable = createCablePiece();
  const eastCable = createCablePiece();
  const westEnd = buildTornEnd();
  const eastEnd = buildTornEnd();
  illustratedGroup.add(intactCable.group, westCable.group, eastCable.group, westEnd, eastEnd);

  const measuredCable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sampleCable(-85, 85, 0, false)), 400, CABLE_RADIUS, 14, false), new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.cable, emissive: WEBGL_COLORS.cable, emissiveIntensity: 0.2, roughness: 0.4 }));
  measuredGroup.add(measuredCable);
  const measuredCutRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 10, 48), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm }));
  measuredCutRing.rotation.x = Math.PI / 2;
  measuredCutRing.position.set(0, computeHeight(0, 0, false) + 0.3, 0);
  measuredGroup.add(measuredCutRing);

  const anchorMaterial = createAnchorSteelMaterial(SCENE_COLORS.closeUpAnchor, options.sky);
  const anchor = buildAnchorModel(anchorMaterial);
  anchor.group.scale.setScalar(ANCHOR_UNITS_PER_METRE);
  anchor.group.rotation.order = "YXZ";
  anchor.group.rotation.y = Math.PI / 2;
  anchor.group.rotation.x = -0.22;
  anchor.group.rotation.z = ANCHOR_ROLL_RADIANS;
  illustratedGroup.add(anchor.group);

  // The chain toward the ship (+x) with the detector's catenary for the depth at the cut: on the sand first for its
  // grounded length, following the drawn-in relief, then rising. Without a modelled chain it rises straight ahead.
  // The first few metres bend down from the shackle (above the sand, the anchor lies on its side) to the ground. It is
  // laid out for the anchor at rest and slides with the anchor.
  const restAnchorY = computeBaseHeight(ANCHOR_X, 0, true) + computeFurrowOffset(ANCHOR_X, 0, ANCHOR_X) + ANCHOR_LIFT;
  anchor.group.position.set(ANCHOR_X, restAnchorY, 0);
  anchor.group.updateMatrixWorld(true);
  const shacklePosition = anchor.shackleLocal.clone().applyMatrix4(anchor.group.matrixWorld);
  const modelledPoints = options.chainShape?.points ?? [{ alongMetres: 0, upMetres: 0 }, { alongMetres: 160, upMetres: 120 }];
  const chainPoints = modelledPoints.filter((point) => point.alongMetres >= CHAIN_DROP_METRES).map((point) => {
    const localX = shacklePosition.x + point.alongMetres / METRES_PER_UNIT;
    const groundY = computeBaseHeight(localX, 0, true) + CHAIN_SAND_CLEARANCE;
    return new THREE.Vector3(localX, groundY + point.upMetres / METRES_PER_UNIT, 0);
  });
  chainPoints.unshift(shacklePosition.clone());
  const chainCurve = new THREE.CatmullRomCurve3(chainPoints, false, "centripetal");
  const chain = new THREE.InstancedMesh(buildStudLinkGeometry(), anchorMaterial, CHAIN_LINKS);
  const linkMatrix = new THREE.Matrix4();
  const linkQuaternion = new THREE.Quaternion();
  const twistQuaternion = new THREE.Quaternion();
  const linkScale = new THREE.Vector3(ANCHOR_UNITS_PER_METRE, ANCHOR_UNITS_PER_METRE, ANCHOR_UNITS_PER_METRE);
  const upAxis = new THREE.Vector3(0, 1, 0);
  // Links follow each other at the drawn link pitch from the shackle, as far as the chain reaches.
  const chainLength = chainCurve.getLength();
  for (let link = 0; link < CHAIN_LINKS; link += 1) {
    const along = Math.min(1, (link * CHAIN_LINK_PITCH_UNITS) / chainLength);
    const tangent = chainCurve.getTangentAt(along);
    linkQuaternion.setFromUnitVectors(upAxis, tangent);
    twistQuaternion.setFromAxisAngle(tangent, link % 2 === 0 ? 0 : Math.PI / 2);
    linkQuaternion.premultiply(twistQuaternion);
    linkMatrix.compose(chainCurve.getPointAt(along), linkQuaternion, linkScale);
    chain.setMatrixAt(link, linkMatrix);
  }
  chain.castShadow = true;
  const chainGroup = new THREE.Group();
  chainGroup.add(chain);
  illustratedGroup.add(chainGroup);

  // Shared corners are welded first, so the noise moves them together and the normals come out smooth.
  const rockShell = new THREE.IcosahedronGeometry(1, 3);
  rockShell.deleteAttribute("normal");
  rockShell.deleteAttribute("uv");
  const rockGeometry = mergeVertices(rockShell);
  rockShell.dispose();
  const rockPositions = rockGeometry.getAttribute("position");
  for (let index = 0; index < rockPositions.count; index += 1) {
    const pointX = rockPositions.getX(index);
    const pointY = rockPositions.getY(index);
    const pointZ = rockPositions.getZ(index);
    const bulge = 0.72 + sampleFractalNoise(pointX * 1.6 + pointZ * 0.7 + 5, pointY * 1.6 - pointZ * 0.9, 3) * 0.55;
    rockPositions.setXYZ(index, pointX * bulge, pointY * bulge * 0.62, pointZ * bulge);
  }
  rockGeometry.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeometry, caustics.createMaterial({ roughness: 0.9, metalness: 0 }, 0.18), ROCK_COUNT);
  const rockColor = new THREE.Color();
  const rockMatrix = new THREE.Matrix4();
  const rockRotation = new THREE.Quaternion();
  const rockEuler = new THREE.Euler();
  let placedRocks = 0;
  for (let attempt = 0; attempt < ROCK_COUNT * 6 && placedRocks < ROCK_COUNT; attempt += 1) {
    const localX = (random() - 0.5) * PATCH_SIZE_UNITS * 0.92;
    const localZ = (random() - 0.5) * PATCH_SIZE_UNITS * 0.92;
    const distanceToCable = Math.abs(localX * cableLocal.z - localZ * cableLocal.x);
    if (Math.abs(localZ) < 9 || distanceToCable < 2.5) continue;
    if (sampleFractalNoise(localX * 0.04, localZ * 0.04, 2) < 0.38) continue;
    const size = 0.25 + Math.pow(random(), 3) * 1.8;
    rockEuler.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    rockRotation.setFromEuler(rockEuler);
    rockMatrix.compose(new THREE.Vector3(localX, computeBaseHeight(localX, localZ, true) - size * 0.32, localZ), rockRotation, new THREE.Vector3(size, size, size));
    rocks.setMatrixAt(placedRocks, rockMatrix);
    rocks.setColorAt(placedRocks, rockColor.setHSL(0.09 + random() * 0.05, 0.08 + random() * 0.06, 0.42 + random() * 0.16));
    placedRocks += 1;
  }
  rocks.count = placedRocks;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  illustratedGroup.add(rocks);

  // Silt: each grain is thrown up where the anchor passed at its own moment, rises and drifts, and settles once the
  // cable has parted; a pure function of the moment, so scrubbing back clears it.
  const plume = kit.createSoftPoints(PLUME_COUNT, { map: options.softDot, color: SCENE_COLORS.closeUpPlume, size: 2.4, opacity: 0.3 });
  const plumePositions = plume.positions;
  const plumeSeeds = Array.from({ length: PLUME_COUNT }, () => ({ bornShare: random(), across: (random() - 0.5) * 6, rise: random(), drift: 0.4 + random() * 0.8 }));
  illustratedGroup.add(plume.object);

  const rayTexture = createRayTexture();
  const lightShafts = Array.from({ length: LIGHT_SHAFT_COUNT }, (_slot, index) => {
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(7 + random() * 5, 95),
      new THREE.MeshBasicMaterial({ map: rayTexture, color: SCENE_COLORS.lightShaft, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    shaft.position.set((random() - 0.5) * 90, 40, (random() - 0.5) * 90);
    scene.add(shaft);
    return { mesh: shaft, phase: index * 1.7, tilt: (random() - 0.5) * 0.3 };
  });

  const cableLabel = makeStackedLabel(options.cableLabel, "measured route").object;
  cableLabel.position.copy(cablePoint(-34, 0, true)).add(new THREE.Vector3(0, 3.2, 0));
  scene.add(cableLabel);
  const cutLabel = makeLabel("Cut", "alarm");
  cutLabel.position.copy(cablePoint(0, 0, true)).add(new THREE.Vector3(0, 2.4, 0));
  scene.add(cutLabel);
  const anchorLabel = makeStackedLabel("Anchor", "illustrated").object;
  anchor.group.add(anchorLabel);
  anchorLabel.position.set(0, 1.8 / ANCHOR_UNITS_PER_METRE, 0);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 420);
  const controls = new OrbitControls(camera, options.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 75;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enabled = false;
  // Home frames the torn ends and the anchor together, from the side the chain does not cross.
  const homeTarget = new THREE.Vector3(5, computeBaseHeight(5, 0, true) + 0.8, 0);
  const homePosition = new THREE.Vector3(-4, homeTarget.y + 14, 13);

  function resetCamera() {
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
  }
  resetCamera();

  function setIllustrated(isIllustrated: boolean) {
    illustratedGroup.visible = isIllustrated;
    measuredGroup.visible = !isIllustrated;
    lightShafts.forEach((shaft) => {
      shaft.mesh.visible = isIllustrated;
    });
  }
  setIllustrated(true);

  let drawnSeconds = Number.NaN;
  /** Poses the sequence at `seconds` from the cut: furrow, anchor and chain, the cable whole or parted, the silt. */
  function poseSequence(seconds: number) {
    if (seconds === drawnSeconds) return;
    drawnSeconds = seconds;
    const state = readCutState(seconds);
    anchorXNow = state.anchorX;
    illustratedPatch.regrowFurrow(state.anchorX);
    const groundY = computeHeight(state.anchorX, 0, true);
    anchor.group.position.set(state.anchorX, groundY + ANCHOR_LIFT, 0);
    chainGroup.position.set(state.anchorX - ANCHOR_X, anchor.group.position.y - restAnchorY, 0);
    intactCable.group.visible = !state.isParted;
    westCable.group.visible = state.isParted;
    eastCable.group.visible = state.isParted;
    westEnd.visible = state.isParted;
    eastEnd.visible = state.isParted;
    if (state.isParted) {
      westCable.rebuild(sampleCable(-85, -state.endGap - 0.05, state.endBend, true));
      eastCable.rebuild(sampleCable(state.endGap + 0.05, 85, state.endBend, true));
      placeTornEnd(westEnd, westCable.readCurve(), false);
      placeTornEnd(eastEnd, eastCable.readCurve(), true);
    } else {
      intactCable.rebuild(sampleCable(-85, 85, state.bight, true));
    }
    cutLabel.visible = state.isParted;
    // The cut's name sits over the gap between the torn ends.
    if (state.isParted) cutLabel.position.copy(westEnd.position).lerp(eastEnd.position, 0.5).add(CUT_LABEL_LIFT);
    const beats = CUT_SEQUENCE_SECONDS;
    plumeSeeds.forEach((seed, index) => {
      const bornAt = interpolate(beats.enter, beats.part + 20, seed.bornShare);
      const age = seconds - bornAt;
      if (age < 0 || state.siltRise <= 0) {
        plumePositions[index * 3 + 1] = -999;
        return;
      }
      const bornX = readCutState(bornAt).anchorX - 1.5;
      const rise = Math.min(1, age / 40) * (0.4 + seed.rise) * state.siltRise;
      plumePositions[index * 3] = bornX - Math.min(8, age * 0.05) * seed.drift;
      plumePositions[index * 3 + 1] = computeHeight(bornX, seed.across, true) + 0.4 + rise * 5;
      plumePositions[index * 3 + 2] = seed.across * (1 + Math.min(2, age / 60)) * seed.drift;
    });
    plume.markMoved();
  }

  function update(atMs: number, nowSeconds: number) {
    caustics.setTime(prefersReducedMotion ? 2 : nowSeconds);
    for (const shaft of lightShafts) {
      shaft.mesh.rotation.set(0, Math.atan2(camera.position.x - shaft.mesh.position.x, camera.position.z - shaft.mesh.position.z), shaft.tilt);
      const shaftMaterial = shaft.mesh.material;
      shaftMaterial.opacity = prefersReducedMotion ? 0.18 : 0.14 + 0.08 * Math.sin(nowSeconds * 0.35 + shaft.phase);
    }
    // The sequence runs on the replay's clock, held at its first and last beat outside its window.
    const seconds = clampValue((atMs - options.cutAtMs) / 1000, CUT_SEQUENCE_SECONDS.enter, CUT_SEQUENCE_SECONDS.siltSettled);
    poseSequence(seconds);
  }

  return { scene, camera, controls, update, setIllustrated, resetCamera };
}
