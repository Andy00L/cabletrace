import { cameraPosition, clamp, distance, float, modelWorldMatrix, normalLocal, positionLocal, vec3, vec4 } from "three/tsl";
import { Color, MeshBasicNodeMaterial } from "three/webgpu";
import { keepDataColorExact } from "@/lib/render/data-colors";
import { MIN_WIDTH_SHARE } from "@/lib/seabed/scene/tube-thinning";

// A data tube for the WebGPU tier: unlit in its exact data colour (src/lib/render/data-colors.ts) and narrowing with
// camera distance as the WebGL tiers' GLSL does (src/lib/seabed/scene/tube-thinning.ts, same arithmetic, so the
// lookdev probes from readThinnedTubeMiddle still land on the drawn tube).

type DataTubeOptions = { hex: string; radiusKm: number; fullWidthDistanceKm: number; opacity?: number; depthWrite?: boolean };

/** Only for TubeGeometry built with `radiusKm`: each vertex finds its centreline point from the tube's radial normal. */
export function createThinnedDataTubeNodeMaterial(options: DataTubeOptions): MeshBasicNodeMaterial {
  const { hex, radiusKm, fullWidthDistanceKm, opacity = 1, depthWrite = true } = options;
  const material = keepDataColorExact(new MeshBasicNodeMaterial({ color: new Color(hex), opacity, depthWrite }));
  const tubeCentre = positionLocal.sub(normalLocal.mul(radiusKm));
  const cameraDistance = distance(modelWorldMatrix.mul(vec4(tubeCentre, 1)).xyz, cameraPosition);
  const widthShare = clamp(cameraDistance.div(fullWidthDistanceKm), float(MIN_WIDTH_SHARE), float(1));
  material.positionNode = tubeCentre.add(normalLocal.mul(widthShare.mul(radiusKm))).sub(vec3(0, float(radiusKm).mul(float(1).sub(widthShare)), 0));
  return material;
}
