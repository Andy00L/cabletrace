import * as THREE from "three";

// Canvas-drawn textures for the seabed scene. Browser only (they draw on a canvas element).

function createCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d") };
}

/** A round dot that fades to transparent: sediment particles and the cable signal's glow. */
export function createSoftDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, context } = createCanvas(size, size);
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return createCanvasTexture(canvas);
}

/** A light shaft: bright at the top, fading down and toward both edges. */
export function createRayTexture(): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(64, 256);
  if (context) {
    const vertical = context.createLinearGradient(0, 0, 0, 256);
    vertical.addColorStop(0, "rgba(255,255,255,0.9)");
    vertical.addColorStop(0.6, "rgba(255,255,255,0.25)");
    vertical.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = vertical;
    context.fillRect(0, 0, 64, 256);
    context.globalCompositeOperation = "destination-in";
    const horizontal = context.createLinearGradient(0, 0, 64, 0);
    horizontal.addColorStop(0, "rgba(0,0,0,0)");
    horizontal.addColorStop(0.5, "rgba(0,0,0,1)");
    horizontal.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = horizontal;
    context.fillRect(0, 0, 64, 256);
  }
  return createCanvasTexture(canvas);
}
