import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createSeededRandom, sampleFractalNoise, smoothStep } from "@/lib/seabed/math";
import { buildStudLinkGeometry } from "@/lib/seabed/scene/models";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { createRayTexture } from "@/lib/seabed/scene/textures";
import type { WaterLook } from "@/lib/seabed/scene/water-surface";

// What the overview draws under the water when the camera comes close to the anchor (the Vessel view, the anchor cam):
// the chain as real stud links instead of a hairline, the furrow the anchor ploughs as a trench in the sediment, and
// the inside of the water (a teal haze with distance, light falling from above, no map labels). Scene units are km.

/** Stud links along a drawn chain, at the anchor's drawn scale; the overview's hairline stays for the far views. */
export type ChainLinks = {
  mesh: THREE.InstancedMesh;
  /** Places the links along `points` (x, y, z triples, `pointCount` of them) from the first point. */
  update: (points: Float32Array, pointCount: number) => void;
};

/**
 * `linkPitchKm`: the drawn distance between links (a 0.5 m link at the anchor's drawn scale); `linkScale` scales the
 * link geometry (built in metres) to scene units.
 */
export function createChainLinks(material: THREE.Material, maxLinks: number, linkPitchKm: number, linkScale: number): ChainLinks {
  const mesh = new THREE.InstancedMesh(buildStudLinkGeometry(), material, maxLinks);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.count = 0;
  const curvePoints = Array.from({ length: 2 }, () => new THREE.Vector3());
  const linkMatrix = new THREE.Matrix4();
  const linkQuaternion = new THREE.Quaternion();
  const twistQuaternion = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(linkScale, linkScale, linkScale);
  const tangent = new THREE.Vector3();
  const position = new THREE.Vector3();
  return {
    mesh,
    update(points, pointCount) {
      while (curvePoints.length < pointCount) curvePoints.push(new THREE.Vector3());
      for (let index = 0; index < pointCount; index += 1) curvePoints[index]?.fromArray(points, index * 3);
      const curve = new THREE.CatmullRomCurve3(curvePoints.slice(0, pointCount), false, "centripetal");
      const length = curve.getLength();
      const count = Math.min(maxLinks, Math.floor(length / linkPitchKm));
      for (let link = 0; link < count; link += 1) {
        const along = (link * linkPitchKm) / length;
        curve.getTangentAt(along, tangent);
        curve.getPointAt(along, position);
        linkQuaternion.setFromUnitVectors(upAxis, tangent);
        // Each link turns a quarter turn from the last, as stud-link chain lies.
        twistQuaternion.setFromAxisAngle(tangent, link % 2 === 0 ? 0 : Math.PI / 2);
        linkQuaternion.premultiply(twistQuaternion);
        linkMatrix.compose(position, linkQuaternion, scale);
        mesh.setMatrixAt(link, linkMatrix);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** The furrow as ground: a trench of darker, wetter sediment with a lighter berm thrown up on both sides. */
export type FurrowTrench = { mesh: THREE.Mesh; setFraction: (fraction: number) => void };

// Across the trench, from one berm's outer edge to the other: offset as a share of the half width, height above the
// seabed as a share of the berm height, and how much of the trench floor's shade (0 berm, 1 floor). The trench cannot
// cut into the terrain's surface, so its floor lies on it, darker, between berms raised on both sides.
const TRENCH_PROFILE = [
  { offset: -1, height: 0, floor: 0 },
  { offset: -0.62, height: 1, floor: 0 },
  { offset: -0.34, height: 0.1, floor: 1 },
  { offset: 0, height: 0, floor: 1 },
  { offset: 0.34, height: 0.1, floor: 1 },
  { offset: 0.62, height: 1, floor: 0 },
  { offset: 1, height: 0, floor: 0 },
] as const;

// The trench floor's and the berms' brightness against the seabed around them (linear light), drawn unlit like the
// terrain's tokens so the ground around keeps its tone.
const TRENCH_FLOOR_SHADE = 0.55;
const TRENCH_BERM_SHADE = 0.92;

/**
 * A trench along `points` (on the seabed, km), `halfWidthKm` wide each side and `depthKm` deep, revealed from its start
 * by `setFraction` as the anchor ploughs it. `sampleSeabedHeight` puts each cross-section on the ground under it.
 */
export function createFurrowTrench(
  points: readonly THREE.Vector3[],
  halfWidthKm: number,
  depthKm: number,
  sampleSeabedHeight: (sceneX: number, sceneZ: number) => number,
  readSeabedColor: (sceneX: number, sceneZ: number, target: THREE.Color) => THREE.Color,
): FurrowTrench {
  const across = TRENCH_PROFILE.length;
  const positions = new Float32Array(points.length * across * 3);
  const colors = new Float32Array(points.length * across * 3);
  const seabedColor = new THREE.Color();
  const mixed = new THREE.Color();
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const directionX = next.x - previous.x;
    const directionZ = next.z - previous.z;
    const length = Math.hypot(directionX, directionZ) || 1;
    const normalX = -directionZ / length;
    const normalZ = directionX / length;
    TRENCH_PROFILE.forEach((sample, lane) => {
      const sampleX = point.x + normalX * halfWidthKm * sample.offset;
      const sampleZ = point.z + normalZ * halfWidthKm * sample.offset;
      const vertex = index * across + lane;
      positions[vertex * 3] = sampleX;
      positions[vertex * 3 + 1] = sampleSeabedHeight(sampleX, sampleZ) + depthKm * sample.height + 0.006;
      positions[vertex * 3 + 2] = sampleZ;
      // The seabed's own colour there: darker where the flukes turned up wet sediment, a shade lighter on the berms.
      readSeabedColor(sampleX, sampleZ, seabedColor);
      mixed.copy(seabedColor).multiplyScalar(TRENCH_FLOOR_SHADE * sample.floor + TRENCH_BERM_SHADE * (1 - sample.floor)).toArray(colors, vertex * 3);
    });
  });
  const indices: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    for (let lane = 0; lane < across - 1; lane += 1) {
      const current = index * across + lane;
      const next = current + across;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  const indicesPerSection = (across - 1) * 6;
  return {
    mesh,
    setFraction(fraction) {
      const sections = Math.round(Math.min(1, Math.max(0, fraction)) * (points.length - 1));
      geometry.setDrawRange(0, sections * indicesPerSection);
      mesh.visible = sections > 0;
    },
  };
}

/**
 * The inside of the water, for a camera under the surface: a haze in the water's own body colour with distance (light
 * scattered back by the water), lighter overhead where the daylight comes down, shafts of light falling from the
 * surface in front of the camera, caustic light rippling over the seabed around it (an additive decal, so the terrain's
 * material is untouched), and the surface itself hidden (from below, the sky's window would be a bright disc; the
 * background's lit top stands in).
 */
export type UnderwaterLook = { group: THREE.Group; apply: (scene: THREE.Scene, camera: THREE.Camera, isUnderwater: boolean) => void };

// Haze density (per km, exponential squared): 1.0 keeps a subject 0.6 km away 70% clear and hides the seabed 2.5 km out.
const UNDERWATER_HAZE_PER_KM = 1.0;
// Shafts of light: how many, how bright (additive), where they stand in front of the camera (km ahead, km either side)
// and how far they lean with the sun (radians).
const LIGHT_SHAFT_COUNT = 9;
const LIGHT_SHAFT_OPACITY = 0.38;
const LIGHT_SHAFT_AHEAD_KM = [0.25, 0.9] as const;
const LIGHT_SHAFT_SPREAD_KM = 0.55;
const LIGHT_SHAFT_LEAN = 0.18;
// The background: lighter toward the surface by this share of the way to the sky's colour, darker below by this share
// of the way to black.
const BACKGROUND_SURFACE_SKY_SHARE = 0.45;
const BACKGROUND_DEPTH_DARK_SHARE = 0.35;
// The caustic decal: a square this wide (km) on the seabed ahead of the camera, this many cells a side, its pattern
// repeating every this many km (about the anchor's drawn width), this bright, and this far over the ground (km).
const CAUSTIC_DECAL_KM = 1.6;
const CAUSTIC_DECAL_CELLS = 48;
const CAUSTIC_PERIOD_KM = 0.14;
const CAUSTIC_OPACITY = 0.12;
// The light's strength wanders over the seabed (the waves focus it unevenly), on this scale (km).
const CAUSTIC_PATCH_KM = 0.35;
const CAUSTIC_LIFT_KM = 0.004;
const CAUSTIC_SEED = 20241225;
// The caustic tile's size (px).
const CAUSTIC_TEXTURE_PX = 256;

/** `aboveWaterFog` is the haze the scene keeps while the camera is above the surface (overview.ts). */
export function createUnderwaterLook(look: WaterLook, sampleSeabedHeight: (sceneX: number, sceneZ: number) => number, aboveWaterFog: THREE.Fog | null): UnderwaterLook {
  const hazeColor = new THREE.Color(look.column);
  const fog = new THREE.FogExp2(hazeColor, UNDERWATER_HAZE_PER_KM);
  const background = createUnderwaterBackground(look);
  const rayTexture = createRayTexture();
  const lightShafts = new THREE.Group();
  const shaftMaterial = new THREE.MeshBasicMaterial({ map: rayTexture, color: SCENE_COLORS.lightShaft, transparent: true, opacity: LIGHT_SHAFT_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const shaftRandom = createSeededRandom(CAUSTIC_SEED);
  const shaftLayout = Array.from({ length: LIGHT_SHAFT_COUNT }, () => ({
    aheadKm: LIGHT_SHAFT_AHEAD_KM[0] + shaftRandom() * (LIGHT_SHAFT_AHEAD_KM[1] - LIGHT_SHAFT_AHEAD_KM[0]),
    acrossKm: (shaftRandom() - 0.5) * 2 * LIGHT_SHAFT_SPREAD_KM,
    widthKm: 0.04 + shaftRandom() * 0.08,
  }));
  shaftLayout.forEach((layout) => lightShafts.add(new THREE.Mesh(new THREE.PlaneGeometry(layout.widthKm, 3.2), shaftMaterial)));
  const group = new THREE.Group();
  group.add(lightShafts);
  group.visible = false;
  // The caustic decal (its texture takes tens of ms to draw) is made the first time a camera goes under the surface,
  // never on the replay's first frame.
  let caustics: ReturnType<typeof createCausticDecal> | null = null;
  const forward = new THREE.Vector3();
  return {
    group,
    apply(scene, camera, isUnderwater) {
      scene.fog = isUnderwater ? fog : aboveWaterFog;
      scene.background = isUnderwater ? background : null;
      group.visible = isUnderwater;
      if (!isUnderwater) return;
      if (!caustics) {
        caustics = createCausticDecal(sampleSeabedHeight);
        group.add(caustics.mesh);
      }
      // The shafts stand in front of the camera, from the surface down, leaning with the sun and turned to face it.
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) forward.set(1, 0, 0);
      forward.normalize();
      lightShafts.children.forEach((shaft, index) => {
        const layout = shaftLayout[index];
        if (!layout) return;
        shaft.position.set(camera.position.x + forward.x * layout.aheadKm - forward.z * layout.acrossKm, -1.6, camera.position.z + forward.z * layout.aheadKm + forward.x * layout.acrossKm);
        shaft.rotation.set(0, Math.atan2(camera.position.x - shaft.position.x, camera.position.z - shaft.position.z), LIGHT_SHAFT_LEAN);
      });
      caustics.moveTo(camera.position.x + forward.x * CAUSTIC_DECAL_KM * 0.4, camera.position.z + forward.z * CAUSTIC_DECAL_KM * 0.4);
    },
  };
}

/** The caustic light as a decal: a grid laid on the seabed, its pattern fixed to the ground as the grid moves. */
function createCausticDecal(sampleSeabedHeight: (sceneX: number, sceneZ: number) => number): { mesh: THREE.Mesh; moveTo: (centreX: number, centreZ: number) => void } {
  const geometry = new THREE.PlaneGeometry(CAUSTIC_DECAL_KM, CAUSTIC_DECAL_KM, CAUSTIC_DECAL_CELLS, CAUSTIC_DECAL_CELLS);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const uvs = geometry.getAttribute("uv");
  const localX = Float32Array.from({ length: positions.count }, (_slot, index) => positions.getX(index));
  const localZ = Float32Array.from({ length: positions.count }, (_slot, index) => positions.getZ(index));
  // The decal fades to nothing at its edge, so its square never shows.
  const fades = Float32Array.from({ length: positions.count }, (_slot, index) => {
    const edge = Math.max(Math.abs(localX[index] ?? 0), Math.abs(localZ[index] ?? 0)) / (CAUSTIC_DECAL_KM / 2);
    return 1 - Math.min(1, Math.max(0, (edge - 0.55) / 0.45));
  });
  const strengths = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
  geometry.setAttribute("color", strengths);
  const material = new THREE.MeshBasicMaterial({ map: createCausticTexture(), vertexColors: true, color: SCENE_COLORS.lightShaft, transparent: true, opacity: CAUSTIC_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    moveTo(centreX, centreZ) {
      for (let index = 0; index < positions.count; index += 1) {
        const pointX = centreX + (localX[index] ?? 0);
        const pointZ = centreZ + (localZ[index] ?? 0);
        positions.setXYZ(index, pointX, sampleSeabedHeight(pointX, pointZ) + CAUSTIC_LIFT_KM, pointZ);
        uvs.setXY(index, pointX / CAUSTIC_PERIOD_KM, pointZ / CAUSTIC_PERIOD_KM);
        const strength = (fades[index] ?? 0) * smoothStep(0.3, 0.7, sampleFractalNoise(pointX / CAUSTIC_PATCH_KM, pointZ / CAUSTIC_PATCH_KM, 2));
        strengths.setXYZ(index, strength, strength, strength);
      }
      positions.needsUpdate = true;
      uvs.needsUpdate = true;
      strengths.needsUpdate = true;
    },
  };
}

/**
 * A tileable caustic pattern: the bright network where sunlight focused by the waves meets the seabed, drawn as the
 * edges between cells of a wrapped Worley pattern (thin where two cells' nearest points are equally near).
 */
function createCausticTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const random = createSeededRandom(CAUSTIC_SEED);
  // Two networks, the second finer and fainter, so no cell shape repeats as a tiling would.
  const coarsePoints = Array.from({ length: 18 }, () => ({ x: random() * CAUSTIC_TEXTURE_PX, y: random() * CAUSTIC_TEXTURE_PX }));
  const finePoints = Array.from({ length: 46 }, () => ({ x: random() * CAUSTIC_TEXTURE_PX, y: random() * CAUSTIC_TEXTURE_PX }));
  const canvas = document.createElement("canvas");
  canvas.width = CAUSTIC_TEXTURE_PX;
  canvas.height = CAUSTIC_TEXTURE_PX;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();
  const image = context.createImageData(CAUSTIC_TEXTURE_PX, CAUSTIC_TEXTURE_PX);
  for (let row = 0; row < CAUSTIC_TEXTURE_PX; row += 1) {
    for (let column = 0; column < CAUSTIC_TEXTURE_PX; column += 1) {
      // The lines wave, as light focused by moving water does; the periods divide the tile so it still wraps.
      const wavedX = column + 5 * Math.sin((row * 2 * Math.PI) / 64);
      const wavedY = row + 5 * Math.sin((column * 2 * Math.PI) / 128);
      const coarse = readCausticLine(readCellEdgeDistance(wavedX, wavedY, coarsePoints));
      const fine = readCausticLine(readCellEdgeDistance(wavedY, wavedX, finePoints));
      const brightness = Math.round(255 * Math.min(1, Math.max(coarse, 0.55 * fine)));
      image.data.set([brightness, brightness, brightness, 255], (row * CAUSTIC_TEXTURE_PX + column) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The gap (px) between a point's nearest and second-nearest cell centres on the wrapped tile: 0 on a cell edge. */
function readCellEdgeDistance(pointX: number, pointY: number, centres: readonly { x: number; y: number }[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (const centre of centres) {
    const offsetX = Math.abs((((pointX - centre.x) % CAUSTIC_TEXTURE_PX) + CAUSTIC_TEXTURE_PX) % CAUSTIC_TEXTURE_PX);
    const offsetY = Math.abs((((pointY - centre.y) % CAUSTIC_TEXTURE_PX) + CAUSTIC_TEXTURE_PX) % CAUSTIC_TEXTURE_PX);
    const distance = Math.hypot(Math.min(offsetX, CAUSTIC_TEXTURE_PX - offsetX), Math.min(offsetY, CAUSTIC_TEXTURE_PX - offsetY));
    if (distance < nearest) {
      second = nearest;
      nearest = distance;
    } else if (distance < second) {
      second = distance;
    }
  }
  return second - nearest;
}

/** A caustic line's brightness at a distance (px) from its cell edge: a thin bright core with a soft glow. */
function readCausticLine(edgeDistance: number): number {
  return 0.8 * Math.max(0, 1 - edgeDistance / 3) ** 2 + 0.2 * Math.max(0, 1 - edgeDistance / 14) ** 2;
}

/** A vertical gradient: daylight overhead, the body colour at eye level and darker water below. */
function createUnderwaterBackground(look: WaterLook): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `#${new THREE.Color(look.column).lerp(new THREE.Color(look.sky), BACKGROUND_SURFACE_SKY_SHARE).getHexString()}`);
    gradient.addColorStop(0.5, look.column);
    gradient.addColorStop(1, `#${new THREE.Color(look.column).lerp(new THREE.Color(0, 0, 0), BACKGROUND_DEPTH_DARK_SHARE).getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The anchor's note under the water (the anchor cam): one small "illustrated" chip, not the map label's long text. */
export function makeIllustratedChip(): CSS2DObject {
  const element = document.createElement("div");
  element.className = "rounded-full bg-card/85 px-1.5 text-micro text-muted shadow-row";
  element.textContent = "illustrated";
  return new CSS2DObject(element);
}
