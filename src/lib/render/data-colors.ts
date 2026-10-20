import * as THREE from "three";

// Data colours are sacred (docs/UI_DESIGN_SYSTEM.md, Data): a cable is #2F6BD8 on screen, not a lit, tone-mapped,
// water-tinted cousin of it. Every data line in the 3D view is therefore drawn
//   - unlit: the material's colour is the pixel's colour, whatever the sun, sky or shadows do;
//   - outside tone mapping: the renderer's Neutral curve would subtract up to 0.04 from every channel;
//   - outside the scene's haze (the look's fog, scene-look.ts), which would mix the haze colour into the line;
//   - after the water: in the transparent pass, at a render order past the water surface, the wake and the hull's
//     contact shadow, so nothing blends over it. It still depth-tests against the terrain and the hulls.
// The lookdev harness (scripts/lookdev) samples the drawn lines and fails when a channel is off by more than 2.

/** Render order of data lines: after the water (2), the Kelvin wake (2.5), the contact shadow (2.6) and the foam trail (3). */
export const DATA_LINE_RENDER_ORDER = 5;

/** Turns a material into a data-line material in place: no tone mapping, no haze, drawn in the pass after the water. */
export function keepDataColorExact<TMaterial extends THREE.Material>(material: TMaterial): TMaterial {
  material.toneMapped = false;
  // No haze either: under the water (the anchor cam) the scene's fog would tint the line.
  if ("fog" in material) material.fog = false;
  // Transparent only so it sorts after the water; fully opaque lines stay opaque unless they asked for an opacity.
  material.transparent = true;
  return material;
}

/** An unlit material in a data colour for tubes and markers, exact on screen. */
export function createDataColorMaterial(hex: string, options: { opacity?: number; depthWrite?: boolean } = {}): THREE.MeshBasicMaterial {
  return keepDataColorExact(new THREE.MeshBasicMaterial({ color: hex, opacity: options.opacity ?? 1, depthWrite: options.depthWrite ?? true }));
}

/** Gives a drawn data line the render order that puts it after the water. */
export function drawAfterWater<TObject extends THREE.Object3D>(object: TObject): TObject {
  object.renderOrder = DATA_LINE_RENDER_ORDER;
  return object;
}
