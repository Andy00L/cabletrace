import * as THREE from "three";
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
 * The inside of the water, for a camera under the surface: a haze toward the water's own colour with distance (light
 * scattered back by the water), brighter overhead where the daylight comes down, a few shafts of light falling from the
 * surface, and the surface itself hidden (from below, the sky's window would be a bright disc; the haze stands in).
 */
export type UnderwaterLook = { lightShafts: THREE.Group; apply: (scene: THREE.Scene, camera: THREE.Camera, isUnderwater: boolean) => void };

// Haze density (per km, exponential squared): 1.0 keeps a subject 0.6 km away 70% clear and hides the seabed 2.5 km out.
const UNDERWATER_HAZE_PER_KM = 1.0;
const LIGHT_SHAFT_COUNT = 9;
// The haze leans toward the sky's colour by this share: water lit from above scatters lighter than its body colour.
const HAZE_SKY_SHARE = 0.25;

export function createUnderwaterLook(look: WaterLook): UnderwaterLook {
  const hazeColor = new THREE.Color(look.column).lerp(new THREE.Color(look.sky), HAZE_SKY_SHARE);
  const fog = new THREE.FogExp2(hazeColor, UNDERWATER_HAZE_PER_KM);
  const background = createUnderwaterBackground(look, hazeColor);
  const rayTexture = createRayTexture();
  const lightShafts = new THREE.Group();
  const shaftMaterial = new THREE.MeshBasicMaterial({ map: rayTexture, color: SCENE_COLORS.lightShaft, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  for (let index = 0; index < LIGHT_SHAFT_COUNT; index += 1) {
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.06 + (index % 3) * 0.04, 3.2), shaftMaterial);
    // Spread on a ring around the group's centre, leaning a little with the sun.
    const angle = (index / LIGHT_SHAFT_COUNT) * Math.PI * 2;
    shaft.position.set(Math.cos(angle) * (0.35 + 0.15 * (index % 4)), -0.4, Math.sin(angle) * (0.35 + 0.15 * (index % 4)));
    shaft.rotation.z = 0.12;
    lightShafts.add(shaft);
  }
  lightShafts.visible = false;
  return {
    lightShafts,
    apply(scene, camera, isUnderwater) {
      scene.fog = isUnderwater ? fog : null;
      scene.background = isUnderwater ? background : null;
      lightShafts.visible = isUnderwater;
      if (!isUnderwater) return;
      // The shafts stand around the camera's sight line and turn to face it.
      lightShafts.position.set(camera.position.x, 0, camera.position.z);
      lightShafts.children.forEach((shaft) => {
        shaft.rotation.y = Math.atan2(camera.position.x - lightShafts.position.x - shaft.position.x, camera.position.z - lightShafts.position.z - shaft.position.z);
      });
    },
  };
}

/** A vertical gradient: daylight overhead fading to the haze at eye level and darker water below. */
function createUnderwaterBackground(look: WaterLook, hazeColor: THREE.Color): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, look.sky);
    gradient.addColorStop(0.45, `#${hazeColor.getHexString()}`);
    gradient.addColorStop(1, look.column);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
