import { mix, pow, step, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

// The sRGB transfer functions (IEC 61966-2-1) as typed TSL nodes, per channel. three.js ships the same functions
// (sRGBTransferOETF, sRGBTransferEOTF) but types their results loosely; these keep vec3 in and out.

const LINEAR_KNEE = 0.0031308;
const ENCODED_KNEE = 0.04045;

/** Linear light to sRGB-encoded values. */
export function encodeSrgb(color: Node<"vec3">): Node<"vec3"> {
  const curved = pow(color, vec3(1 / 2.4, 1 / 2.4, 1 / 2.4)).mul(1.055).sub(0.055);
  return mix(curved, color.mul(12.92), step(color, vec3(LINEAR_KNEE, LINEAR_KNEE, LINEAR_KNEE)));
}

/** sRGB-encoded values to linear light. */
export function decodeSrgb(color: Node<"vec3">): Node<"vec3"> {
  const curved = pow(color.add(0.055).div(1.055), vec3(2.4, 2.4, 2.4));
  return mix(curved, color.div(12.92), step(color, vec3(ENCODED_KNEE, ENCODED_KNEE, ENCODED_KNEE)));
}
