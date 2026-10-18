import * as THREE from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { drawAfterWater, keepDataColorExact } from "@/lib/render/data-colors";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";
import { createSeededRandom } from "@/lib/seabed/math";

// The cables and pipelines as things on the seabed, for the views that look at them from close by (the Vessel view,
// the close-up), as a cable engineer would draw them: a cable is a black jacket of polypropylene yarn wound helically
// over its steel armour wires, lying partly buried in the sediment; a pipeline is a steel pipe in a concrete weight
// coating with a field joint every pipe length. Each carries a thin tracer along its top in its exact data colour
// (drawn after the water, unlit: src/lib/render/data-colors.ts), so it is still identified by colour. The map views
// keep the crisp data-coloured tubes (overview.ts).

export type SeabedLineKind = "cable" | "pipeline";

/** One physical line: its group (the body and the tracer) and the tracer's centreline, which the colour probes read. */
export type PhysicalLine = { group: THREE.Group; tracerCurve: THREE.CatmullRomCurve3 };

// The tracer: device pixels wide, and how far over the line's top it rides (a share of the radius) so it never sinks
// into the body.
const TRACER_WIDTH_PX = 2;
const TRACER_LIFT_SHARE = 1.04;
// How much of the radius stays above the sediment: a cable settles into it, a pipeline lies on it.
const CENTRE_ABOVE_SEABED_SHARE: Record<SeabedLineKind, number> = { cable: 0.62, pipeline: 0.9 };
// The jacket's yarn pattern repeats every this many radii along the line; a concrete coating every this many.
const SERVING_REPEAT_RADII = 6;
const COATING_REPEAT_RADII = 14;
const COATING_SEED = 19830401;

/** The cable's outer serving: black polypropylene yarn wound helically over the armour wires. */
export function createCableServingTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#24262A";
  context.fillRect(0, 0, 128, 64);
  // Yarn strands at the armour's lay angle, each with a lit edge and a shadowed one.
  for (let offset = -64; offset < 192; offset += 8) {
    context.strokeStyle = "#3B3F46";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + 64, 64);
    context.stroke();
    context.strokeStyle = "#17181B";
    context.lineWidth = 1;
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

/** Concrete weight coating: mottled grey with a darker field joint band at one end of each pipe length. */
function createConcreteCoatingTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const nextRandom = createSeededRandom(COATING_SEED);
  context.fillStyle = "#8D8B84";
  context.fillRect(0, 0, 128, 32);
  for (let fleck = 0; fleck < 260; fleck += 1) {
    const shade = Math.round(110 + nextRandom() * 60);
    context.fillStyle = `rgba(${shade},${shade - 2},${shade - 8},0.5)`;
    context.fillRect(nextRandom() * 128, nextRandom() * 32, 1 + nextRandom() * 2, 1 + nextRandom() * 2);
  }
  context.fillStyle = "#5E5C57";
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
  const serving = createCableServingTexture();
  const coating = createConcreteCoatingTexture();
  return {
    cable: { material: new THREE.MeshStandardMaterial({ color: "#FFFFFF", map: serving, roughness: 0.78, metalness: 0.05 }), repeatRadii: SERVING_REPEAT_RADII },
    pipeline: { material: new THREE.MeshStandardMaterial({ color: "#FFFFFF", map: coating, roughness: 0.95, metalness: 0 }), repeatRadii: COATING_REPEAT_RADII },
  };
}

/**
 * The physical line along `restingPoints` (on the seabed, evened out along the line, km), `radiusKm` thick, with its
 * tracer in `hex`. Hidden until the caller shows it.
 */
export function createPhysicalLine(options: { restingPoints: readonly THREE.Vector3[]; radiusKm: number; kind: SeabedLineKind; hex: string; materials: SeabedLineMaterials; kit: SceneMaterialKit }): PhysicalLine {
  const { restingPoints, radiusKm, kind, hex, materials, kit } = options;
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
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, centreline.length * 3), radiusKm, 10, false), lineMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  const tracerPoints = centreline.map((point) => new THREE.Vector3(point.x, point.y + radiusKm * TRACER_LIFT_SHARE, point.z));
  const tracerCurve = new THREE.CatmullRomCurve3(tracerPoints, false, "centripetal");
  const tracerGeometry = new LineGeometry();
  tracerGeometry.setPositions(tracerCurve.getSpacedPoints(Math.max(12, tracerPoints.length * 3)).flatMap((point) => [point.x, point.y, point.z]));
  const tracer = drawAfterWater(kit.createScreenLine(tracerGeometry, { color: hex, widthPx: TRACER_WIDTH_PX, hasVertexColors: false, opacity: 1 }));
  if (!Array.isArray(tracer.material)) keepDataColorExact(tracer.material);
  const group = new THREE.Group();
  group.add(body, tracer);
  group.visible = false;
  return { group, tracerCurve };
}
