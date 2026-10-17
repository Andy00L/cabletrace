import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type ProgressLine = {
  line: Line2;
  /** Draws the line from its start up to `fraction` (0 to 1) of its length. */
  setFraction: (fraction: number) => void;
};

type ProgressLineOptions = {
  points: readonly THREE.Vector3[];
  color: string;
  widthPx: number;
  opacity?: number;
};

/**
 * A line that keeps the same on-screen width at every zoom, revealed segment by segment as the replay moves.
 * Used for the vessel's track and the anchor's furrow, which must read both across the whole gulf and next to
 * the vessel. Expects points spaced evenly by distance, so a fraction of segments is a fraction of length.
 */
export function createProgressLine(options: ProgressLineOptions): ProgressLine {
  const { points, color, widthPx, opacity = 1 } = options;
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((point) => [point.x, point.y, point.z]));
  const segmentCount = Math.max(0, points.length - 1);
  const material = new LineMaterial({ color, linewidth: widthPx, transparent: opacity < 1, opacity, worldUnits: false });
  const line = new Line2(geometry, material);
  geometry.instanceCount = 0;
  return {
    line,
    setFraction(fraction) {
      geometry.instanceCount = Math.round(Math.min(1, Math.max(0, fraction)) * segmentCount);
    },
  };
}
