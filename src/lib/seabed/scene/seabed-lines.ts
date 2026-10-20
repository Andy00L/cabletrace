import * as THREE from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { drawAfterWater, keepDataColorExact } from "@/lib/render/data-colors";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";
import { createSeededRandom } from "@/lib/seabed/math";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// The cables and pipelines as things on the seabed, for the views that look at them from close by (the Vessel view,
// the close-up): a cable is armour wires wound helically under a serving, lying partly buried in the sediment, drawn in
// the cable's data blue and lit (the approved close-up's armoured cable); a pipeline is a pipe in a weight coating with
// a field joint every pipe length, drawn in the pipeline's data colour and lit. Each carries a tracer along its top in
// its exact data colour (drawn after the water, unlit: src/lib/render/data-colors.ts), so the line is identified by
// its colour at any distance. The map views keep the crisp data-coloured tubes (overview.ts).

export type SeabedLineKind = "cable" | "pipeline";

/**
 * One physical line: its group (the body and the tracer), the tracer's centreline, which the colour probes read, and
 * the tracer's drawn vertices, which the lookdev continuity check follows.
 */
export type PhysicalLine = { group: THREE.Group; tracerCurve: THREE.CatmullRomCurve3; tracerPoints: readonly THREE.Vector3[] };

// The tracer: device pixels wide (3 keeps one pixel of exact colour inside the antialiased edges), and how far over the
// line's top it rides (a share of the radius) so it never sinks into the body.
export const TRACER_WIDTH_PX = 3;
const TRACER_LIFT_SHARE = 1.04;
// The tracer never dips under the seabed between its points: it rides this far (km) over the highest ground sampled
// along each step, every this many km.
const TRACER_GROUND_CLEARANCE_KM = 0.006;
const TRACER_STEP_KM = 0.04;
// A depth bias for the tracer (in depth-buffer steps, 2^-24 of the range each): a few metres near the camera, a few
// hundred far away, so the sediment's small relief in front of a distant line never cuts it into dashes, while a hull
// a kilometre and more above the seabed still hides it.
const TRACER_DEPTH_BIAS_STEPS = -2000;
// The bodies' render order: in the transparent pass before the water surface (2, water-surface.ts).
const LINE_BODY_RENDER_ORDER = 1;
// How much of the radius stays above the sediment: a cable settles into it, a pipeline lies on it.
const CENTRE_ABOVE_SEABED_SHARE: Record<SeabedLineKind, number> = { cable: 0.62, pipeline: 0.9 };
// The armour's lay repeats every this many radii along the line; a pipe length every this many.
const ARMOUR_REPEAT_RADII = 6;
const COATING_REPEAT_RADII = 14;
const COATING_SEED = 19830401;

/**
 * The cable's armour under its serving, in the cable's data blue: strands at the lay angle, each with a lit edge and
 * a shadowed one (colours from SCENE_COLORS, the approved close-up's armour).
 */
export function createCableArmourTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = WEBGL_COLORS.cable;
  context.fillRect(0, 0, 128, 64);
  for (let offset = -64; offset < 192; offset += 8) {
    context.strokeStyle = SCENE_COLORS.armourStripe;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + 64, 64);
    context.stroke();
    context.strokeStyle = SCENE_COLORS.armourShade;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(offset + 3, 0);
    context.lineTo(offset + 67, 64);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** The pipeline's weight coating in its data colour: mottled, with a darker field joint band at one end of each pipe length. */
function createPipelineCoatingTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const nextRandom = createSeededRandom(COATING_SEED);
  context.fillStyle = WEBGL_COLORS.pipeline;
  context.fillRect(0, 0, 128, 32);
  for (let fleck = 0; fleck < 260; fleck += 1) {
    context.fillStyle = nextRandom() < 0.5 ? "rgba(255,240,220,0.18)" : "rgba(40,20,0,0.18)";
    context.fillRect(nextRandom() * 128, nextRandom() * 32, 1 + nextRandom() * 2, 1 + nextRandom() * 2);
  }
  context.fillStyle = "rgba(40,20,0,0.35)";
  context.fillRect(0, 0, 6, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** The two bodies' materials, made once per scene; each line clones its texture to set its own repeat. */
export type SeabedLineMaterials = Record<SeabedLineKind, { material: THREE.MeshStandardMaterial; repeatRadii: number }>;

export function createSeabedLineMaterials(): SeabedLineMaterials {
  const armour = createCableArmourTexture();
  const coating = createPipelineCoatingTexture();
  return {
    cable: { material: new THREE.MeshStandardMaterial({ color: "#FFFFFF", map: armour, roughness: 0.42, metalness: 0.35 }), repeatRadii: ARMOUR_REPEAT_RADII },
    pipeline: { material: new THREE.MeshStandardMaterial({ color: "#FFFFFF", map: coating, roughness: 0.8, metalness: 0 }), repeatRadii: COATING_REPEAT_RADII },
  };
}

/**
 * A data line's tracer: a fixed-pixel line in `hex`, exact on screen (data-colors.ts), drawn after the water. At the
 * map's scales (`hasDepthBias`) it is biased toward the camera in depth (TRACER_DEPTH_BIAS_STEPS) so the sediment's
 * relief never breaks it; the close-up, a few metres across, needs no bias.
 */
export function createTracerLine(geometry: LineGeometry, hex: string, kit: SceneMaterialKit, hasDepthBias: boolean): THREE.Mesh {
  const tracer = drawAfterWater(kit.createScreenLine(geometry, { color: hex, widthPx: TRACER_WIDTH_PX, hasVertexColors: false, opacity: 1 }));
  if (!Array.isArray(tracer.material)) {
    keepDataColorExact(tracer.material);
    tracer.material.polygonOffset = hasDepthBias;
    tracer.material.polygonOffsetUnits = hasDepthBias ? TRACER_DEPTH_BIAS_STEPS : 0;
  }
  tracer.frustumCulled = false;
  return tracer;
}

/**
 * The physical line along `restingPoints` (on the seabed, evened out along the line, km), `radiusKm` thick, with its
 * tracer in `hex`. `sampleSeabedHeight` keeps the tracer over the ground between the resting points. Hidden until the
 * caller shows it.
 */
export function createPhysicalLine(options: {
  restingPoints: readonly THREE.Vector3[];
  radiusKm: number;
  kind: SeabedLineKind;
  hex: string;
  materials: SeabedLineMaterials;
  kit: SceneMaterialKit;
  sampleSeabedHeight: (sceneX: number, sceneZ: number) => number;
}): PhysicalLine {
  const { restingPoints, radiusKm, kind, hex, materials, kit, sampleSeabedHeight } = options;
  const centreLift = radiusKm * CENTRE_ABOVE_SEABED_SHARE[kind];
  const centreline = restingPoints.map((point) => new THREE.Vector3(point.x, point.y + centreLift, point.z));
  const curve = new THREE.CatmullRomCurve3(centreline, false, "centripetal");
  const { material, repeatRadii } = materials[kind];
  const lineMaterial = material.clone();
  if (material.map) {
    lineMaterial.map = material.map.clone();
    lineMaterial.map.repeat.set(curve.getLength() / (repeatRadii * radiusKm), 1);
    lineMaterial.map.needsUpdate = true;
  }
  // The bodies are drawn back to front before the water and write no depth, so where one line crosses over another
  // the lower line's tracer still shows: every tracer stays continuous, hidden only by the ground and the hulls.
  lineMaterial.transparent = true;
  lineMaterial.depthWrite = false;
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, centreline.length * 3), radiusKm, 10, false), lineMaterial);
  body.renderOrder = LINE_BODY_RENDER_ORDER;
  body.castShadow = true;
  body.receiveShadow = true;
  const tracerPoints = liftOverGround(curve.getSpacedPoints(Math.max(12, Math.ceil(curve.getLength() / TRACER_STEP_KM))), radiusKm * TRACER_LIFT_SHARE, sampleSeabedHeight);
  const tracerCurve = new THREE.CatmullRomCurve3(tracerPoints, false, "centripetal");
  const tracerGeometry = new LineGeometry();
  tracerGeometry.setPositions(tracerPoints.flatMap((point) => [point.x, point.y, point.z]));
  const group = new THREE.Group();
  group.add(body, createTracerLine(tracerGeometry, hex, kit, true));
  group.visible = false;
  return { group, tracerCurve, tracerPoints };
}

/**
 * Points `lift` over the centreline, each raised further where the ground around it (at the point and halfway to each
 * neighbour) comes within TRACER_GROUND_CLEARANCE_KM, so a straight step between two points never passes under it.
 */
function liftOverGround(centre: readonly THREE.Vector3[], lift: number, sampleSeabedHeight: (sceneX: number, sceneZ: number) => number): THREE.Vector3[] {
  return centre.map((point, index) => {
    const previous = centre[Math.max(0, index - 1)] ?? point;
    const next = centre[Math.min(centre.length - 1, index + 1)] ?? point;
    const groundHeights = [
      sampleSeabedHeight(point.x, point.z),
      sampleSeabedHeight((point.x + previous.x) / 2, (point.z + previous.z) / 2),
      sampleSeabedHeight((point.x + next.x) / 2, (point.z + next.z) / 2),
    ];
    const highestGround = Math.max(...groundHeights);
    return new THREE.Vector3(point.x, Math.max(point.y + lift, highestGround + TRACER_GROUND_CLEARANCE_KM), point.z);
  });
}
