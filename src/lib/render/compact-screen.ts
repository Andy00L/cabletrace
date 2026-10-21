// Phones get a lighter 3D replay: on an iPhone in Safari the replay loaded slower than on a desktop, and with the CPU
// slowed 4 times (a phone's) the cased tubes, the full grid's upload and the shader links took most of the 3.8 to
// 4.4 s to the first frame. The compact budget (viewer.ts, COMPACT_BUDGET) draws the half grid at a pixel ratio of at
// most 1.5, on WebGL (no WebGPU adapter check, no WGSL pipelines compiled on first use), without the sand ripples and
// with the plain hulls. Browser only; false on the server.

// The longest short side, in CSS px, a phone has (an iPhone Pro Max is 440 x 956; an iPad mini's short side is 744).
const COMPACT_SHORT_SIDE_PX = 600;

/** Whether this is a phone's screen: a coarse pointer (a finger) and a short side of at most COMPACT_SHORT_SIDE_PX. */
export function isCompactScreen(): boolean {
  if (typeof window === "undefined") return false;
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  return isCoarsePointer && Math.min(window.screen.width, window.screen.height) <= COMPACT_SHORT_SIDE_PX;
}
