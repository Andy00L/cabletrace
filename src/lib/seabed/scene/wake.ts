import * as THREE from "three";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { ScenePoint } from "@/lib/seabed/terrain";

// The wake behind the moving vessel: a foam trail along the path it just sailed, widening and fading with
// age, and the two arms of the V that open at 19.47 degrees on each side (the Kelvin wake angle of any
// ship in deep water). Built from the replay track, so it follows scrubbing exactly.

const TRAIL_POINTS = 48;
const ARM_POINTS = 16;
const KELVIN_HALF_ANGLE = (19.47 * Math.PI) / 180;
// The wake floats this far above the water surface (km) so it never flickers into it.
const SURFACE_LIFT = 0.012;
// Below this trail length (km) the vessel is treated as stopped and the wake is hidden.
const MIN_TRAIL_KM = 0.05;
// Cross-sections, from one edge to the other: offset as a share of the half width, and opacity as a share of
// the strip's opacity at that point. Transparent edges keep the foam soft instead of a hard-edged ribbon.
const TRAIL_PROFILE = { offsets: [-1, -0.55, 0, 0.55, 1], opacities: [0, 0.85, 1, 0.85, 0] };
const ARM_PROFILE = { offsets: [-1, 0, 1], opacities: [0, 1, 0] };

type Profile = { offsets: number[]; opacities: number[] };
type Strip = { firstVertex: number; pointCount: number; profile: Profile };

export type Wake = {
  mesh: THREE.Mesh;
  /** `trail` runs from the stern backward along the path sailed. */
  update: (trail: readonly ScenePoint[], halfWidthKm: number) => void;
};

export function createWake(): Wake {
  const trailVertices = TRAIL_POINTS * TRAIL_PROFILE.offsets.length;
  const armVertices = ARM_POINTS * ARM_PROFILE.offsets.length;
  const strips: Strip[] = [
    { firstVertex: 0, pointCount: TRAIL_POINTS, profile: TRAIL_PROFILE },
    { firstVertex: trailVertices, pointCount: ARM_POINTS, profile: ARM_PROFILE },
    { firstVertex: trailVertices + armVertices, pointCount: ARM_POINTS, profile: ARM_PROFILE },
  ];
  const vertexCount = trailVertices + armVertices * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4).fill(1);
  const indices: number[] = [];
  for (const strip of strips) {
    const across = strip.profile.offsets.length;
    for (let point = 0; point < strip.pointCount - 1; point += 1) {
      for (let lane = 0; lane < across - 1; lane += 1) {
        const current = strip.firstVertex + point * across + lane;
        const next = current + across;
        indices.push(current, next, current + 1, current + 1, next, next + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ color: SCENE_COLORS.wake, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  function writeStrip(strip: Strip, points: readonly ScenePoint[], widthAt: (amount: number) => number, opacityAt: (amount: number) => number) {
    const { offsets, opacities } = strip.profile;
    for (let point = 0; point < strip.pointCount; point += 1) {
      const amount = point / (strip.pointCount - 1);
      const current = points[Math.min(point, points.length - 1)];
      const neighbour = points[Math.min(point + 1, points.length - 1)] ?? current;
      const previous = points[Math.max(point - 1, 0)] ?? current;
      if (!current || !neighbour || !previous) continue;
      const directionX = neighbour.x - previous.x;
      const directionZ = neighbour.z - previous.z;
      const length = Math.hypot(directionX, directionZ) || 1;
      const normalX = -directionZ / length;
      const normalZ = directionX / length;
      const width = widthAt(amount);
      const opacity = point < points.length ? opacityAt(amount) : 0;
      // Written in place: this runs every frame, so no temporary arrays.
      for (let lane = 0; lane < offsets.length; lane += 1) {
        const offset = offsets[lane] ?? 0;
        const vertex = strip.firstVertex + point * offsets.length + lane;
        positions[vertex * 3] = current.x + normalX * width * offset;
        positions[vertex * 3 + 1] = SURFACE_LIFT;
        positions[vertex * 3 + 2] = current.z + normalZ * width * offset;
        colors[vertex * 4 + 3] = opacity * (opacities[lane] ?? 0);
      }
    }
  }

  function update(trail: readonly ScenePoint[], halfWidthKm: number) {
    const first = trail[0];
    const last = trail[trail.length - 1];
    const trailKm = first && last ? Math.hypot(first.x - last.x, first.z - last.z) : 0;
    mesh.visible = trailKm > MIN_TRAIL_KM;
    if (!mesh.visible || !first) return;
    const sampled = Array.from({ length: TRAIL_POINTS }, (_slot, index) => trail[Math.round((index / (TRAIL_POINTS - 1)) * (trail.length - 1))] ?? first);
    const trailStrip = strips[0];
    if (trailStrip) writeStrip(trailStrip, sampled, (amount) => halfWidthKm * (0.9 + 2.6 * amount), (amount) => 0.9 * Math.pow(1 - amount, 1.4));

    const second = trail[1] ?? first;
    const backLength = Math.hypot(second.x - first.x, second.z - first.z) || 1;
    const backX = (second.x - first.x) / backLength;
    const backZ = (second.z - first.z) / backLength;
    const armLength = trailKm * 0.55;
    [1, -1].forEach((side, armIndex) => {
      const strip = strips[armIndex + 1];
      if (!strip) return;
      const cosine = Math.cos(KELVIN_HALF_ANGLE);
      const sine = Math.sin(KELVIN_HALF_ANGLE) * side;
      const armX = backX * cosine - backZ * sine;
      const armZ = backX * sine + backZ * cosine;
      const armPoints = Array.from({ length: ARM_POINTS }, (_slot, index) => {
        const distance = (index / (ARM_POINTS - 1)) * armLength;
        return { x: first.x + armX * distance, z: first.z + armZ * distance };
      });
      writeStrip(strip, armPoints, () => halfWidthKm * 0.45, (amount) => 0.6 * Math.pow(1 - amount, 1.2));
    });
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
  }

  return { mesh, update };
}
