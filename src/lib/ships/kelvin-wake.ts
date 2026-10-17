import * as THREE from "three";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { HullForm } from "@/lib/ships/hull-form";

// The waves a ship makes, for the GPU tier: a patch of water in the ship's own frame carrying the bow wave and the
// Kelvin wake of both the bow and the stern. In deep water every ship's wake is the same pattern scaled by its speed:
// waves of wavenumber k0 = g / U^2 along the track, confined to a wedge of half angle asin(1/3) = 19.47 degrees
// behind each source, with transverse waves across the track and divergent waves along the cusp lines (Kelvin's ship
// wave, by stationary phase; drawn as a height and normal offset as the plan asks, after Keen 2010,
// https://ori.ox.ac.uk/media/5790/keen2010gpu.pdf). A wave moving at angle psi to the track has wavenumber
// k0 / cos^2 psi; at a point seen at angle theta from the source the two waves that stand still in the ship's frame
// satisfy tan theta = tan psi / (1 + 2 tan^2 psi). The pattern is
// steady in the ship's frame, so it needs no clock: it moves with the hull and changes only with speed.
// The heights move the surface (vertex shader, the long bow wave only: the patch grid cannot carry a 6 m wavelength)
// and the slopes tilt the normal in every pixel (fragment shader), which is what catches the sun.

const STANDARD_GRAVITY = 9.80665;
// Patch extent in ship lengths: a little ahead of the bow, three lengths astern, 1.4 lengths to each side.
const AHEAD_LENGTHS = 0.15;
const ASTERN_LENGTHS = 3;
const SIDE_LENGTHS = 1.4;
const GRID_ALONG = 160;
const GRID_ACROSS = 96;
// Below this speed (m/s, about 1 knot) a hull makes no wake worth drawing.
const MIN_WAKE_SPEED = 0.5;
// Wave height scale: half the speed head U^2 / g, about 0.66 m at 7 knots, near what such hulls raise; never more
// than an eighth of the draught, so a fast small craft does not raise a wave taller than its own freeboard.
const HEIGHT_PER_SPEED_HEAD = 0.5;
const MAX_HEIGHT_TO_DRAUGHT = 0.125;

const WAKE_UNIFORMS = /* glsl */ `
uniform float wakeWavenumber;
uniform float wakeAmplitude;
uniform float wakeBowX;
uniform float wakeSternX;
uniform float wakeHalfBeam;
uniform float wakeLength;
varying vec2 vWakeLocal;

// The bow wave: a crest that climbs the bow on both sides and runs out along the hull.
float readBowWave(vec2 point) {
  float along = (point.x - (wakeBowX - 0.06 * wakeLength)) / (0.07 * wakeLength);
  float across = (abs(point.y) - wakeHalfBeam) / (0.35 * wakeHalfBeam + 1.0);
  return 1.4 * exp(-along * along - across * across);
}
`;

// Fragment shader only: fwidth keeps the waves from aliasing.
const KELVIN_GLSL = /* glsl */ `
// tan(19.47 deg) = 1 / sqrt(8): the cusp of the Kelvin wedge.
const float KELVIN_CUSP = 0.35355339;

// One source's Kelvin pattern at a point (metres, ship frame), as a share of the amplitude, and its two phases.
float readKelvin(vec2 point, float sourceX) {
  float behind = sourceX - point.x;
  if (behind <= 0.0) return 0.0;
  float tanTheta = abs(point.y) / behind;
  if (tanTheta >= KELVIN_CUSP) return 0.0;
  float discriminant = sqrt(max(1.0 - 8.0 * tanTheta * tanTheta, 0.0));
  float safeTan = max(tanTheta, 1e-4);
  float transverseTan = (1.0 - discriminant) / (4.0 * safeTan);
  float divergentTan = (1.0 + discriminant) / (4.0 * safeTan);
  float transversePhase = wakeWavenumber * behind * (1.0 + transverseTan * tanTheta) * sqrt(1.0 + transverseTan * transverseTan);
  float divergentPhase = wakeWavenumber * behind * (1.0 + divergentTan * tanTheta) * sqrt(1.0 + divergentTan * divergentTan);
  // Waves fade where a pixel spans more than half a wavelength, instead of turning into moire.
  float transverseDetail = 1.0 - smoothstep(1.5, 3.0, fwidth(transversePhase));
  float divergentDetail = (1.0 - smoothstep(1.5, 3.0, fwidth(divergentPhase))) * smoothstep(0.03, 0.12, tanTheta);
  // The amplitude rises toward the cusp lines and falls with distance (as 1 / sqrt(r)) and with age.
  float cuspRise = inversesqrt(max(discriminant, 0.2));
  float decay = inversesqrt(1.0 + behind / wakeLength) * exp(-behind / (${ASTERN_LENGTHS.toFixed(1)} * wakeLength));
  float wedgeEdge = 1.0 - smoothstep(0.85 * KELVIN_CUSP, KELVIN_CUSP, tanTheta);
  return decay * wedgeEdge * (0.5 * transverseDetail * cos(transversePhase) + 0.65 * cuspRise * divergentDetail * cos(divergentPhase + 0.785398));
}

float readWakeHeight(vec2 point) {
  return wakeAmplitude * (readKelvin(point, wakeBowX) - 0.45 * readKelvin(point, wakeSternX) + readBowWave(point));
}
`;

export type KelvinWake = {
  mesh: THREE.Mesh;
  /** Sets the ship's speed through the water (m/s); below about a knot the patch hides. */
  setSpeed: (speedMetresPerSecond: number) => void;
};

/** The wake patch for one hull, in its frame (metres, waterline y = 0). Add it to the ship's group. */
export function createKelvinWake(form: HullForm): KelvinWake {
  const lengthMetres = form.lengthMetres;
  const fromX = -form.halfLength - ASTERN_LENGTHS * lengthMetres;
  const toX = form.bowX + AHEAD_LENGTHS * lengthMetres;
  const geometry = new THREE.PlaneGeometry(toX - fromX, 2 * SIDE_LENGTHS * lengthMetres, GRID_ALONG, GRID_ACROSS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((fromX + toX) / 2, 0, 0);
  const uniforms = {
    wakeWavenumber: { value: 1 },
    wakeAmplitude: { value: 0 },
    wakeBowX: { value: form.bowX - 0.02 * lengthMetres },
    wakeSternX: { value: -form.halfLength },
    wakeHalfBeam: { value: form.halfBeam },
    wakeLength: { value: lengthMetres },
  };
  const material = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.water, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WAKE_UNIFORMS}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWakeLocal = transformed.xz;\ntransformed.y += wakeAmplitude * readBowWave(transformed.xz);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform mat3 normalMatrix;\n${WAKE_UNIFORMS}\n${KELVIN_GLSL}`)
      .replace(
        "#include <normal_fragment_begin>",
        /* glsl */ `#include <normal_fragment_begin>
float wakeStep = 0.12 / wakeWavenumber;
float wakeHeight = readWakeHeight(vWakeLocal);
float wakeSlopeX = (readWakeHeight(vWakeLocal + vec2(wakeStep, 0.0)) - wakeHeight) / wakeStep;
float wakeSlopeZ = (readWakeHeight(vWakeLocal + vec2(0.0, wakeStep)) - wakeHeight) / wakeStep;
normal = normalize(normalMatrix * vec3(-wakeSlopeX, 1.0, -wakeSlopeZ));`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
// Crests catch the light (lighter), troughs hold the water's colour, foam breaks on the bow wave and the highest
// crests. Where the sea is flat the patch is fully clear, so its edges never show.
float wakeShare = readWakeHeight(vWakeLocal) / max(wakeAmplitude, 1e-4);
float foam = smoothstep(0.6, 1.2, wakeShare);
float insideHull = step(abs(vWakeLocal.y), wakeHalfBeam * 0.92) * step(wakeSternX, vWakeLocal.x) * step(vWakeLocal.x, wakeBowX);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(0.5 * max(wakeShare, 0.0) + foam, 0.0, 1.0));
diffuseColor.a *= clamp(0.8 * abs(wakeShare) + foam, 0.0, 0.95) * (1.0 - insideHull);`,
      );
  };
  material.customProgramCacheKey = () => "ship-kelvin-wake";
  const mesh = new THREE.Mesh(geometry, material);
  // Over the water box (render order 2), under the foam trail (3).
  mesh.renderOrder = 2.5;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    setSpeed(speedMetresPerSecond) {
      const isMoving = speedMetresPerSecond >= MIN_WAKE_SPEED;
      mesh.visible = isMoving;
      if (!isMoving) return;
      uniforms.wakeWavenumber.value = STANDARD_GRAVITY / (speedMetresPerSecond * speedMetresPerSecond);
      uniforms.wakeAmplitude.value = Math.min((HEIGHT_PER_SPEED_HEAD * speedMetresPerSecond * speedMetresPerSecond) / STANDARD_GRAVITY, MAX_HEIGHT_TO_DRAUGHT * form.draught);
    },
  };
}
