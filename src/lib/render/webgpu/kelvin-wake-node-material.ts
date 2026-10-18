import { abs, clamp, cos, exp, float, fwidth, inverseSqrt, materialColor, materialOpacity, max, mix, normalize, positionGeometry, positionLocal, select, smoothstep, sqrt, step, transformNormalToView, uniform, vec2, vec3 } from "three/tsl";
import { Color, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { KelvinWakeMaterial } from "@/lib/render/scene-renderer";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { WAVE_DETAIL_FADE } from "@/lib/seabed/scene/water-surface";
import { KELVIN_PATTERN, type KelvinWakeShape } from "@/lib/ships/kelvin-wake";

// The Kelvin wake patch for the WebGPU tier: the TSL port of src/lib/ships/kelvin-wake.ts (its comment explains the
// physics), from the same KELVIN_PATTERN numbers. The bow wave lifts the patch's vertices; every pixel reads the
// pattern's height and slope for its normal, its crest colour and its opacity.

const PATTERN = KELVIN_PATTERN;

/** Builds the wake's material for one hull shape; `setWave` follows the ship's speed. */
export function createKelvinWakeNodeMaterial(shape: KelvinWakeShape): KelvinWakeMaterial {
  const wavenumber = uniform(1);
  const amplitude = uniform(0);
  const bowX = float(shape.bowX);
  const sternX = float(shape.sternX);
  const halfBeam = float(shape.halfBeam);
  const wakeLength = float(shape.lengthMetres);

  // The bow wave: a crest that climbs the bow on both sides and runs out along the hull.
  const readBowWave = (point: Node<"vec2">): Node<"float"> => {
    const along = point.x.sub(bowX.sub(wakeLength.mul(PATTERN.bowCrestBehindShare))).div(wakeLength.mul(PATTERN.bowCrestLengthShare));
    const across = abs(point.y).sub(halfBeam).div(halfBeam.mul(PATTERN.bowCrestWidthShare).add(1));
    return exp(along.mul(along).add(across.mul(across)).negate()).mul(PATTERN.bowCrestHeight);
  };

  // One source's Kelvin pattern at a point (metres, ship frame), as a share of the amplitude. Computed without
  // branches and masked to the wedge behind the source: WGSL allows fwidth only in uniform control flow.
  const readKelvin = (point: Node<"vec2">, sourceX: Node<"float">): Node<"float"> => {
    const behind = sourceX.sub(point.x);
    const tanTheta = abs(point.y).div(max(behind, float(1e-6)));
    const isInWedge = behind.greaterThan(0).and(tanTheta.lessThan(PATTERN.cuspTangent));
    const discriminant = sqrt(max(float(1).sub(tanTheta.mul(tanTheta).mul(8)), float(0)));
    const safeTan = max(tanTheta, float(1e-4));
    const transverseTan = float(1).sub(discriminant).div(safeTan.mul(4));
    const divergentTan = float(1).add(discriminant).div(safeTan.mul(4));
    const transversePhase = wavenumber.mul(behind).mul(transverseTan.mul(tanTheta).add(1)).mul(sqrt(transverseTan.mul(transverseTan).add(1)));
    const divergentPhase = wavenumber.mul(behind).mul(divergentTan.mul(tanTheta).add(1)).mul(sqrt(divergentTan.mul(divergentTan).add(1)));
    // Waves fade where a pixel spans more than half a wavelength, instead of turning into moire.
    const transverseDetail = float(1).sub(smoothstep(float(WAVE_DETAIL_FADE[0]), float(WAVE_DETAIL_FADE[1]), fwidth(transversePhase)));
    const divergentDetail = float(1)
      .sub(smoothstep(float(WAVE_DETAIL_FADE[0]), float(WAVE_DETAIL_FADE[1]), fwidth(divergentPhase)))
      .mul(smoothstep(float(PATTERN.divergentFadeIn[0]), float(PATTERN.divergentFadeIn[1]), tanTheta));
    // The amplitude rises toward the cusp lines and falls with distance (as 1 / sqrt(r)) and with age.
    const cuspRise = inverseSqrt(max(discriminant, float(PATTERN.cuspFloor)));
    const decay = inverseSqrt(max(behind.div(wakeLength).add(1), float(1e-3))).mul(exp(behind.div(wakeLength.mul(PATTERN.decayLengths)).negate()));
    const wedgeEdge = float(1).sub(smoothstep(float(PATTERN.wedgeEdgeShare * PATTERN.cuspTangent), float(PATTERN.cuspTangent), tanTheta));
    const transverse = transverseDetail.mul(cos(transversePhase)).mul(PATTERN.transverseWeight);
    const divergent = cuspRise.mul(divergentDetail).mul(cos(divergentPhase.add(PATTERN.divergentPhaseShift))).mul(PATTERN.divergentWeight);
    return select(isInWedge, decay.mul(wedgeEdge).mul(transverse.add(divergent)), float(0));
  };

  const readWakeHeight = (point: Node<"vec2">): Node<"float"> => amplitude.mul(readKelvin(point, bowX).sub(readKelvin(point, sternX).mul(PATTERN.sternWeight)).add(readBowWave(point)));

  const material = new MeshStandardNodeMaterial({ color: new Color(SCENE_COLORS.water), roughness: 0.08, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false });
  // The patch's own frame: x along the ship, the second coordinate across it (the GLSL's vWakeLocal).
  const wakeLocal = positionGeometry.xz;
  material.positionNode = positionLocal.add(vec3(0, amplitude.mul(readBowWave(positionLocal.xz)), 0));
  const slopeStep = float(PATTERN.slopeStepWavelengths).div(wavenumber);
  const wakeHeight = readWakeHeight(wakeLocal);
  const slopeX = readWakeHeight(wakeLocal.add(vec2(slopeStep, 0))).sub(wakeHeight).div(slopeStep);
  const slopeZ = readWakeHeight(wakeLocal.add(vec2(0, slopeStep))).sub(wakeHeight).div(slopeStep);
  material.normalNode = normalize(transformNormalToView(vec3(slopeX.negate(), 1, slopeZ.negate())));
  // Crests catch the light (lighter), troughs hold the water's colour, foam breaks on the bow wave and the highest
  // crests. Where the sea is flat the patch is fully clear, so its edges never show.
  const wakeShare = wakeHeight.div(max(amplitude, float(1e-4)));
  const foam = smoothstep(float(PATTERN.foamBand[0]), float(PATTERN.foamBand[1]), wakeShare);
  const isInsideHull = step(abs(wakeLocal.y), halfBeam.mul(PATTERN.hullCutoutShare)).mul(step(sternX, wakeLocal.x)).mul(step(wakeLocal.x, bowX));
  material.colorNode = mix(materialColor, vec3(1, 1, 1), clamp(max(wakeShare, float(0)).mul(PATTERN.crestLightening).add(foam), float(0), float(1)));
  material.opacityNode = materialOpacity.mul(clamp(abs(wakeShare).mul(PATTERN.opacityPerHeight).add(foam), float(0), float(PATTERN.maxOpacity))).mul(float(1).sub(isInsideHull));
  return {
    material,
    setWave(nextWavenumber, amplitudeMetres) {
      wavenumber.value = nextWavenumber;
      amplitude.value = amplitudeMetres;
    },
  };
}

