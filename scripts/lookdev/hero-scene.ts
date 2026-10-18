// The hero shot: Eagle S under way with its wake, seen low from off its starboard bow, drawn with the replay's own
// pieces at the replay's own scale (scene units are km, the ship drawn SHIP_DRAWN_SCALE times, the water 20 times
// deeper), so what this frame shows is what the Vessel view draws, from an angle the console's cameras never take.
// Browser only (the hull plating draws on a canvas). Used by hero-page.ts and captured by hero.ts.
import * as THREE from "three";
import type { SceneMaterialKit } from "../../src/lib/render/scene-renderer";
import { DEPTH_TOKEN_RAMP, SCENE_COLORS } from "../../src/lib/seabed/scene/scene-colors";
import { SCENE_SCALES } from "../../src/lib/seabed/scene-scales";
import { buildWaterBody, createUniformDepthMap, readWaterLook, SKY_HDRI_URL } from "../../src/lib/seabed/scene/water-surface";
import { createWake } from "../../src/lib/seabed/scene/wake";
import { buildShip } from "../../src/lib/ships/build-ship";
import { addShipDetail } from "../../src/lib/ships/ship-detail";
import { createKelvinWake } from "../../src/lib/ships/kelvin-wake";

// Eagle S: 228.6 m, a crude tanker (src/data/cases/eagle-s-2024.ts), under way at 7 knots (3.6 m/s), the pace the
// reconstruction gives it between placed positions during the drag.
const HERO_LENGTH_METRES = 228.6;
const HERO_SPEED_METRES_PER_SECOND = 3.6;
// The Gulf of Finland under the cut is about 60 m deep, drawn 20 times deeper (scene-scales.ts).
const HERO_DEPTH_METRES = 60;
const HERO_WATER_EXAGGERATION = 20;
const METRES_TO_KM = 1 / 1000;
const DRAWN_SCALE = SCENE_SCALES.shipDrawnScale * METRES_TO_KM;
// The sea patch (km): wide enough that its edge sits near the horizon from the low camera.
const SEA_SIZE_KM = 60;
// The camera: off the starboard bow, 0.95 drawn lengths ahead of amidships and as far out, 0.05 drawn lengths up
// (about 11 m at real scale), looking back along the hull toward the stern and the wake.
const CAMERA_AHEAD_LENGTHS = 0.95;
const CAMERA_OUT_LENGTHS = 0.95;
const CAMERA_UP_LENGTHS = 0.05;
const AIM_AHEAD_LENGTHS = -0.05;
const AIM_UP_LENGTHS = 0.03;
const CAMERA_FOV_DEGREES = 30;
// The wake trail behind the stern, as the replay builds it (km): 40 samples of 20 s at the hero's speed.
const WAKE_SAMPLES = 40;
const WAKE_STEP_SECONDS = 20;

export const HERO_FRAME = { widthPx: 1440, heightPx: 900 } as const;

/** The seabed's colour through the water at the hero's depth: the depth token ramp's band for that depth. */
function readSeabedHex(depthMetres: number): string {
  const band = DEPTH_TOKEN_RAMP.find(([bandDepth]) => depthMetres <= bandDepth) ?? DEPTH_TOKEN_RAMP[DEPTH_TOKEN_RAMP.length - 1];
  return band ? band[1] : SCENE_COLORS.water;
}

/**
 * The hero scene and its camera; `isDetailed` adds the GPU tiers' detail (plating relief, waves, the Kelvin wake).
 * `ready` settles once every texture the scene loads has arrived.
 */
export function buildHeroScene(kit: SceneMaterialKit, isDetailed: boolean): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; ready: Promise<void> } {
  const scene = new THREE.Scene();
  scene.environment = kit.createEnvironment();
  scene.environmentIntensity = 0.38;
  const skyLight = new THREE.HemisphereLight(SCENE_COLORS.skyLight, SCENE_COLORS.groundLight, 0.95);
  scene.add(skyLight);
  // The overview's sun: from the north-west, high (overview.ts).
  const sun = new THREE.DirectionalLight(SCENE_COLORS.skyLight, 2.1);
  const drawnLengthKm = HERO_LENGTH_METRES * DRAWN_SCALE;
  sun.position.set(-42, 78, -26).setLength(drawnLengthKm * 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.002;
  Object.assign(sun.shadow.camera, { left: -drawnLengthKm, right: drawnLengthKm, top: drawnLengthKm, bottom: -drawnLengthKm, near: 0.01, far: drawnLengthKm * 8 });
  scene.add(sun);

  const seabedY = -HERO_DEPTH_METRES * HERO_WATER_EXAGGERATION * METRES_TO_KM;
  const seabed = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE_KM, SEA_SIZE_KM), new THREE.MeshBasicMaterial({ color: readSeabedHex(HERO_DEPTH_METRES) }));
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = seabedY;
  scene.add(seabed);
  // The sky HDRI on the GPU tiers, as the replay loads it (viewer.ts).
  let skyMap: THREE.Texture | null = null;
  let ready: Promise<void> = Promise.resolve();
  if (isDetailed) {
    ready = new Promise((resolve) => {
      skyMap = new THREE.TextureLoader().load(SKY_HDRI_URL, () => resolve(), undefined, () => {
        console.error(`[buildHeroScene] the sky ${SKY_HDRI_URL} did not load`);
        resolve();
      });
    });
  }
  if (skyMap !== null) {
    const loadedSky: THREE.Texture = skyMap;
    loadedSky.mapping = THREE.EquirectangularReflectionMapping;
    loadedSky.colorSpace = THREE.LinearSRGBColorSpace;
  }
  const water = buildWaterBody({
    projection: { widthKm: SEA_SIZE_KM, depthKm: SEA_SIZE_KM },
    deepestY: seabedY,
    kit,
    surface: { hasWaves: isDetailed, sun, look: readWaterLook(window.location.search), sky: skyMap, depthMap: createUniformDepthMap(HERO_DEPTH_METRES) },
  });
  water.setWaveTime(0);
  scene.add(water.group);

  const ship = buildShip({ kind: "tanker", lengthMetres: HERO_LENGTH_METRES, tone: "suspect", isDetailed, sky: skyMap });
  addShipDetail(ship, "Eagle S");
  ship.group.scale.setScalar(DRAWN_SCALE);
  scene.add(ship.group);
  if (isDetailed) {
    const kelvinWake = createKelvinWake(ship.form, kit, readWaterLook(window.location.search).column);
    kelvinWake.setSpeed(HERO_SPEED_METRES_PER_SECOND);
    ship.group.add(kelvinWake.mesh);
  }
  const trail = createWake();
  const sternKm = -ship.form.halfLength * DRAWN_SCALE;
  const stepKm = HERO_SPEED_METRES_PER_SECOND * WAKE_STEP_SECONDS * METRES_TO_KM;
  trail.update(
    Array.from({ length: WAKE_SAMPLES + 1 }, (_slot, index) => ({ x: sternKm - index * stepKm, z: 0 })),
    ship.form.halfBeam * DRAWN_SCALE,
  );
  scene.add(trail.mesh);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, HERO_FRAME.widthPx / HERO_FRAME.heightPx, 0.005, SEA_SIZE_KM);
  camera.position.set(CAMERA_AHEAD_LENGTHS * drawnLengthKm, CAMERA_UP_LENGTHS * drawnLengthKm, CAMERA_OUT_LENGTHS * drawnLengthKm);
  camera.lookAt(AIM_AHEAD_LENGTHS * drawnLengthKm, AIM_UP_LENGTHS * drawnLengthKm, 0);
  return { scene, camera, ready };
}
