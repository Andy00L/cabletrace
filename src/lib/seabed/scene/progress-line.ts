import * as THREE from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { keepDataColorExact } from "@/lib/render/data-colors";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";

export type ProgressLine = {
  /** The drawn line: three.js Line2 on WebGL, its WebGPU twin on the WebGPU tier (the renderer's kit picks). */
  line: THREE.Mesh;
  /** Draws the line from its start up to `fraction` (0 to 1) of its length. */
  setFraction: (fraction: number) => void;
  /** How many of its points the line reaches at the last fraction set. */
  readRevealedPointCount: () => number;
};

type ProgressLineOptions = {
  points: readonly THREE.Vector3[];
  /** One color for the whole line, or one per point (the vessel's track turns alarm where the anchor drags). */
  color: string | readonly string[];
  widthPx: number;
  opacity?: number;
  kit: SceneMaterialKit;
  /**
   * A casing under the line: its colour, how many device pixels wider it is and its render order. It shares the
   * line's geometry, so it reveals with it, and writes no depth, so the line draws over it.
   */
  casing?: { color: string; extraPx: number; renderOrder: number };
};

/**
 * A line that keeps the same on-screen width at every zoom, revealed segment by segment as the replay moves.
 * Used for the vessel's track and the anchor's furrow, which must read both across the whole gulf and next to
 * the vessel. Expects points spaced evenly by distance, so a fraction of segments is a fraction of length.
 */
export function createProgressLine(options: ProgressLineOptions): ProgressLine {
  const { points, color, widthPx, opacity = 1, kit } = options;
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((point) => [point.x, point.y, point.z]));
  const segmentCount = Math.max(0, points.length - 1);
  const isPerPoint = typeof color !== "string";
  if (isPerPoint) {
    const pointColor = new THREE.Color();
    geometry.setColors(points.flatMap((_point, index) => pointColor.set(color[index] ?? color[color.length - 1] ?? "#000000").toArray()));
  }
  const line = kit.createScreenLine(geometry, { color: isPerPoint ? "#FFFFFF" : color, hasVertexColors: isPerPoint, widthPx, opacity });
  // Its colours are data colours: no tone mapping (src/lib/render/data-colors.ts).
  const materials = Array.isArray(line.material) ? line.material : [line.material];
  materials.forEach((material) => keepDataColorExact(material));
  if (options.casing) {
    const casing = kit.createScreenLine(geometry, { color: options.casing.color, hasVertexColors: false, widthPx: widthPx + options.casing.extraPx, opacity: 1 });
    const casingMaterials = Array.isArray(casing.material) ? casing.material : [casing.material];
    casingMaterials.forEach((material) => {
      keepDataColorExact(material);
      material.depthWrite = false;
    });
    casing.renderOrder = options.casing.renderOrder;
    line.add(casing);
  }
  geometry.instanceCount = 0;
  line.visible = false;
  return {
    line,
    setFraction(fraction) {
      geometry.instanceCount = Math.round(Math.min(1, Math.max(0, fraction)) * segmentCount);
      // Nothing to draw yet: hidden, so its shaders wait for the scene's second step instead of the first frame.
      line.visible = geometry.instanceCount > 0;
    },
    readRevealedPointCount: () => geometry.instanceCount + 1,
  };
}
