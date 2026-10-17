import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { clampValue, createSeededRandom, interpolate, sampleFractalNoise, smoothStep } from "@/lib/seabed/math";
import type { Caustics } from "@/lib/seabed/scene/caustics";
import { makeLabel, makeStackedLabel } from "@/lib/seabed/scene/labels";
import { buildAnchorModel, buildStudLinkGeometry } from "@/lib/seabed/scene/models";
import { SCENE_SCALES } from "@/lib/seabed/scene-scales";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { createCableArmourTexture, createRayTexture } from "@/lib/seabed/scene/textures";
import type { ScenePoint } from "@/lib/seabed/terrain";

// The close-up of the cut: 1 unit is 2 m and the patch is 320 m square, aligned so the vessel's track runs
// along +x. The surveyed slope stays at true scale; only drawn-in detail (ripples, furrow) is sized up to read.
const METRES_PER_UNIT = 2;
const PATCH_SIZE_UNITS = 160;
const PATCH_SEGMENTS = 240;
const ROCK_COUNT = 280;
const PLUME_COUNT = 220;
// Stud links of about 0.5 m, drawn at the anchor's scale, from the anchor up out of the patch.
const CHAIN_LINKS = 150;
const LIGHT_SHAFT_COUNT = 7;
// Where the anchor rests, units past the cable along the track, and how far its pivot sits above the sand.
// It lies rolled onto one side, as a dragged anchor does: one fluke dug in, the other blade in view.
const ANCHOR_X = 11;
const ANCHOR_LIFT = 1.35;
const ANCHOR_ROLL_RADIANS = 0.8;
// Cable radius in units (0.76 m): drawn thicker than life so it reads at this scale; no source gives the real
// diameter, so the disclosure says "thicker than life" rather than a factor.
const CABLE_RADIUS = 0.38;
// The anchor model is built in metres; this many units per metre draws it at the disclosed scale.
const ANCHOR_UNITS_PER_METRE = SCENE_SCALES.closeUpAnchorScale / METRES_PER_UNIT;
// Half of the gap between the two torn ends, in units.
const CABLE_GAP = 0.9;
// Fixed seed so the illustrated detail is identical on every load (the Estlink 2 cut date).
const DETAIL_SEED = 20241225;

export type CloseUpScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  update: (nowSeconds: number, deltaSeconds: number) => void;
  setIllustrated: (isIllustrated: boolean) => void;
  resetCamera: () => void;
};

type CloseUpOptions = {
  domElement: HTMLElement;
  sampleElevationMetres: (sceneX: number, sceneZ: number) => number;
  cutScene: ScenePoint;
  trackDirection: ScenePoint;
  cableDirection: ScenePoint;
  cableLabel: string;
  /** Reflections for the steel (the overview's room environment); without one, metal renders near black. */
  environment: THREE.Texture | null;
  softDot: THREE.Texture;
  caustics: Caustics;
  prefersReducedMotion: boolean;
};

export function buildCloseUp(options: CloseUpOptions): CloseUpScene {
  const { sampleElevationMetres, cutScene, trackDirection, cableDirection, caustics, prefersReducedMotion } = options;
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

  function computeFurrowOffset(localX: number, localZ: number): number {
    const wobble = (sampleFractalNoise(localX * 0.05, 3.3, 2) - 0.5) * 1.6;
    const across = localZ - wobble;
    const behindAnchor = smoothStep(ANCHOR_X + 1.5, ANCHOR_X - 2, localX);
    const trench = -1.5 * Math.exp(-((across / 1.7) ** 2)) + 0.5 * (Math.exp(-(((across - 3.4) / 1.3) ** 2)) + Math.exp(-(((across + 3.4) / 1.3) ** 2)));
    const mound = 0.45 * Math.exp(-(((localX - (ANCHOR_X + 2.8)) / 1.3) ** 2) - (across / 2.6) ** 2);
    return trench * behindAnchor + mound;
  }

  function computeHeight(localX: number, localZ: number, isIllustrated: boolean): number {
    const overview = toOverview(localX, localZ);
    const baseHeight = (sampleElevationMetres(overview.x, overview.z) - cutElevation) / METRES_PER_UNIT;
    if (!isIllustrated) return baseHeight;
    const relief = (sampleFractalNoise(localX * 0.045 + 11, localZ * 0.045 - 7, 4) - 0.5) * 2.4;
    const rippleWarp = sampleFractalNoise(localX * 0.03, localZ * 0.03, 2) * 6;
    const ripples = Math.sin((localX * 0.55 + localZ * 0.82) * 1.6 + rippleWarp) * 0.18;
    return baseHeight + relief + ripples + computeFurrowOffset(localX, localZ);
  }

  function buildPatch(isIllustrated: boolean): THREE.Mesh {
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
    for (let index = 0; index < positions.count; index += 1) {
      const localX = positions.getX(index);
      const localZ = positions.getZ(index);
      positions.setY(index, computeHeight(localX, localZ, isIllustrated));
      if (isIllustrated) {
        const mudAmount = smoothStep(0.35, 0.7, sampleFractalNoise(localX * 0.06 + 40, localZ * 0.06, 3));
        vertexColor.copy(sand).lerp(mud, mudAmount * 0.8);
        const furrow = computeFurrowOffset(localX, localZ);
        if (furrow < 0) vertexColor.lerp(trenchFloor, clampValue(-furrow / 1.4, 0, 1));
        else vertexColor.lerp(berm, clampValue(furrow / 0.6, 0, 1) * 0.6);
      } else {
        vertexColor.copy(measuredTone);
      }
      vertexColor.toArray(colors, index * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = caustics.apply(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), isIllustrated ? 0.45 : 0.2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  const illustratedGroup = new THREE.Group();
  const measuredGroup = new THREE.Group();
  illustratedGroup.add(buildPatch(true));
  measuredGroup.add(buildPatch(false));
  scene.add(illustratedGroup, measuredGroup);

  const random = createSeededRandom(DETAIL_SEED);
  const cablePoint = (along: number, isIllustrated: boolean) => {
    const bend = isIllustrated ? 5.5 * Math.exp(-((along / 7) ** 2)) : 0;
    const localX = along * cableLocal.x + bend;
    const localZ = along * cableLocal.z;
    return new THREE.Vector3(localX, computeHeight(localX, localZ, isIllustrated) + CABLE_RADIUS * 0.55, localZ);
  };
  const armourTexture = createCableArmourTexture();
  const copperMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.copper, roughness: 0.3, metalness: 0.9, emissive: SCENE_COLORS.copperGlow, emissiveIntensity: 0.25 });
  const steelMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.steel, roughness: 0.35, metalness: 0.75 });

  function buildCablePiece(fromAlong: number, toAlong: number, isIllustrated: boolean) {
    const points: THREE.Vector3[] = [];
    const steps = Math.ceil(Math.abs(toAlong - fromAlong) / 0.8);
    for (let step = 0; step <= steps; step += 1) points.push(cablePoint(interpolate(fromAlong, toAlong, step / steps), isIllustrated));
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const geometry = new THREE.TubeGeometry(curve, points.length * 2, CABLE_RADIUS, 14, false);
    const pieceTexture = armourTexture.clone();
    pieceTexture.repeat.set(curve.getLength() / 1.2, 1);
    pieceTexture.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: pieceTexture, roughness: 0.42, metalness: 0.35 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, curve };
  }

  // Torn end: a copper core pushing out of the armour and splayed steel wires.
  function buildTornEnd(curve: THREE.CatmullRomCurve3, atStart: boolean): THREE.Group {
    const group = new THREE.Group();
    const endPoint = curve.getPointAt(atStart ? 0 : 1);
    const outward = curve.getTangentAt(atStart ? 0 : 1).clone().multiplyScalar(atStart ? -1 : 1);
    const upAxis = new THREE.Vector3(0, 1, 0);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.8, 16), copperMaterial);
    core.quaternion.setFromUnitVectors(upAxis, outward);
    core.position.copy(endPoint).addScaledVector(outward, 0.35);
    group.add(core);
    const side = new THREE.Vector3().crossVectors(outward, upAxis).normalize();
    for (let wire = 0; wire < 9; wire += 1) {
      const radial = side.clone().applyAxisAngle(outward, (wire / 9) * Math.PI * 2);
      const direction = outward.clone().multiplyScalar(0.8).addScaledVector(radial, 0.45 + random() * 0.35).normalize();
      const length = 0.8 + random() * 0.7;
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 6), steelMaterial);
      strand.quaternion.setFromUnitVectors(upAxis, direction);
      strand.position.copy(endPoint).addScaledVector(radial, CABLE_RADIUS * 0.8).addScaledVector(direction, length / 2);
      strand.castShadow = true;
      group.add(strand);
    }
    return group;
  }

  const cableWest = buildCablePiece(-85, -CABLE_GAP, true);
  const cableEast = buildCablePiece(CABLE_GAP, 85, true);
  illustratedGroup.add(cableWest.mesh, cableEast.mesh, buildTornEnd(cableWest.curve, false), buildTornEnd(cableEast.curve, true));
  const measuredCable = buildCablePiece(-85, 85, false);
  measuredCable.mesh.material = new THREE.MeshStandardMaterial({ color: WEBGL_COLORS.cable, emissive: WEBGL_COLORS.cable, emissiveIntensity: 0.2, roughness: 0.4 });
  measuredGroup.add(measuredCable.mesh);
  const measuredCutRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 10, 48), new THREE.MeshBasicMaterial({ color: WEBGL_COLORS.alarm }));
  measuredCutRing.rotation.x = Math.PI / 2;
  measuredCutRing.position.set(0, computeHeight(0, 0, false) + 0.3, 0);
  measuredGroup.add(measuredCutRing);

  const anchorMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.closeUpAnchor, roughness: 0.48, metalness: 0.6 });
  const anchor = buildAnchorModel(anchorMaterial);
  anchor.group.scale.setScalar(ANCHOR_UNITS_PER_METRE);
  anchor.group.rotation.order = "YXZ";
  anchor.group.rotation.y = Math.PI / 2;
  anchor.group.rotation.x = -0.22;
  anchor.group.rotation.z = ANCHOR_ROLL_RADIANS;
  const anchorGroundY = computeHeight(ANCHOR_X, 0, true);
  anchor.group.position.set(ANCHOR_X, anchorGroundY + ANCHOR_LIFT, 0);
  illustratedGroup.add(anchor.group);
  anchor.group.updateMatrixWorld(true);
  const shacklePosition = anchor.shackleLocal.clone().applyMatrix4(anchor.group.matrixWorld);

  const chainCurve = new THREE.QuadraticBezierCurve3(shacklePosition, new THREE.Vector3(ANCHOR_X + 26, anchorGroundY + 2, 1.5), new THREE.Vector3(ANCHOR_X + 62, 52, 4));
  const chain = new THREE.InstancedMesh(buildStudLinkGeometry(), anchorMaterial, CHAIN_LINKS);
  const linkMatrix = new THREE.Matrix4();
  const linkQuaternion = new THREE.Quaternion();
  const twistQuaternion = new THREE.Quaternion();
  const linkScale = new THREE.Vector3(ANCHOR_UNITS_PER_METRE, ANCHOR_UNITS_PER_METRE, ANCHOR_UNITS_PER_METRE);
  const upAxis = new THREE.Vector3(0, 1, 0);
  for (let link = 0; link < CHAIN_LINKS; link += 1) {
    const along = link / (CHAIN_LINKS - 1);
    const tangent = chainCurve.getTangentAt(along);
    linkQuaternion.setFromUnitVectors(upAxis, tangent);
    twistQuaternion.setFromAxisAngle(tangent, link % 2 === 0 ? 0 : Math.PI / 2);
    linkQuaternion.premultiply(twistQuaternion);
    linkMatrix.compose(chainCurve.getPointAt(along), linkQuaternion, linkScale);
    chain.setMatrixAt(link, linkMatrix);
  }
  chain.castShadow = true;
  illustratedGroup.add(chain);

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
  const rocks = new THREE.InstancedMesh(rockGeometry, caustics.apply(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), 0.18), ROCK_COUNT);
  const rockColor = new THREE.Color();
  const rockMatrix = new THREE.Matrix4();
  const rockRotation = new THREE.Quaternion();
  const rockEuler = new THREE.Euler();
  let placedRocks = 0;
  for (let attempt = 0; attempt < ROCK_COUNT * 6 && placedRocks < ROCK_COUNT; attempt += 1) {
    const localX = (random() - 0.5) * PATCH_SIZE_UNITS * 0.92;
    const localZ = (random() - 0.5) * PATCH_SIZE_UNITS * 0.92;
    const distanceToCable = Math.abs(localX * cableLocal.z - localZ * cableLocal.x);
    if (Math.abs(localZ) < 6 || distanceToCable < 2.5) continue;
    if (sampleFractalNoise(localX * 0.04, localZ * 0.04, 2) < 0.38) continue;
    const size = 0.25 + Math.pow(random(), 3) * 1.8;
    rockEuler.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    rockRotation.setFromEuler(rockEuler);
    rockMatrix.compose(new THREE.Vector3(localX, computeHeight(localX, localZ, true) - size * 0.32, localZ), rockRotation, new THREE.Vector3(size, size, size));
    rocks.setMatrixAt(placedRocks, rockMatrix);
    rocks.setColorAt(placedRocks, rockColor.setHSL(0.09 + random() * 0.05, 0.08 + random() * 0.06, 0.42 + random() * 0.16));
    placedRocks += 1;
  }
  rocks.count = placedRocks;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  illustratedGroup.add(rocks);

  const plumePositions = new Float32Array(PLUME_COUNT * 3);
  const plumeSeeds = Array.from({ length: PLUME_COUNT }, () => ({ along: random(), across: (random() - 0.5) * 6, rise: random(), drift: 0.4 + random() * 0.8 }));
  const plumeGeometry = new THREE.BufferGeometry();
  plumeGeometry.setAttribute("position", new THREE.BufferAttribute(plumePositions, 3));
  const plume = new THREE.Points(
    plumeGeometry,
    new THREE.PointsMaterial({ map: options.softDot, color: SCENE_COLORS.closeUpPlume, size: 2.4, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true }),
  );
  plume.frustumCulled = false;
  illustratedGroup.add(plume);

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
  cableLabel.position.copy(cablePoint(-34, true)).add(new THREE.Vector3(0, 3.2, 0));
  scene.add(cableLabel);
  const cutLabel = makeLabel("Cut", "alarm");
  cutLabel.position.copy(cablePoint(0, true)).add(new THREE.Vector3(0, 2.4, 0));
  scene.add(cutLabel);
  const anchorLabel = makeStackedLabel("Anchor", "illustrated").object;
  anchorLabel.position.set(ANCHOR_X + 1, anchorGroundY + 3.6, 0);
  illustratedGroup.add(anchorLabel);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 420);
  const controls = new OrbitControls(camera, options.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 75;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enabled = false;
  // Home frames the torn ends and the anchor together, from the side the chain does not cross.
  const homeTarget = new THREE.Vector3(7, computeHeight(7, 0, true) + 0.8, 0);
  const homePosition = new THREE.Vector3(-2, homeTarget.y + 13, 12);

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

  function update(nowSeconds: number, deltaSeconds: number) {
    caustics.uniform.value = prefersReducedMotion ? 2 : nowSeconds;
    for (const shaft of lightShafts) {
      shaft.mesh.rotation.set(0, Math.atan2(camera.position.x - shaft.mesh.position.x, camera.position.z - shaft.mesh.position.z), shaft.tilt);
      const shaftMaterial = shaft.mesh.material;
      shaftMaterial.opacity = prefersReducedMotion ? 0.18 : 0.14 + 0.08 * Math.sin(nowSeconds * 0.35 + shaft.phase);
    }
    plumeSeeds.forEach((seed, index) => {
      if (!prefersReducedMotion) seed.rise = (seed.rise + deltaSeconds * 0.05 * seed.drift) % 1;
      const localX = interpolate(-24, ANCHOR_X + 2, seed.along);
      const ground = computeHeight(localX, seed.across, true);
      plumePositions[index * 3] = localX + seed.rise * 3;
      plumePositions[index * 3 + 1] = ground + 0.4 + seed.rise * 5 * (0.4 + seed.along);
      plumePositions[index * 3 + 2] = seed.across + seed.rise * 6 * seed.drift;
    });
    plumeGeometry.getAttribute("position").needsUpdate = true;
  }

  return { scene, camera, controls, update, setIllustrated, resetCamera };
}
