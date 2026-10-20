// The photo match's browser side: draws Eagle S's silhouette (the replay's own generator, both levels of detail) from
// a camera given in the photograph's terms, and scores it against the photograph's ship mask without sending the
// render back each time. Bundled by photo-match.ts and opened from a file; it exposes two functions on window:
//   photoMatchLoadMasks(width, height, shipBase64, voidBase64): keeps the photograph's masks (one byte per pixel);
//   photoMatchScore(camera): draws the silhouette and returns its intersection over union with them;
//   photoMatchRender(camera): the silhouette's mask (one byte per pixel, base64), for the overlay.
import * as THREE from "three";
import { buildShip, type ShipModel } from "../../../src/lib/ships/build-ship";
import { addShipDetail } from "../../../src/lib/ships/ship-detail";
import { readCameraPose, type PhotoCamera } from "./photo-camera";

// Eagle S's length overall (m), IMO 9329760.
const EAGLE_S_LENGTH_METRES = 228.6;

type Masks = { width: number; height: number; ship: Uint8Array; voidMask: Uint8Array };

let masks: Masks | null = null;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
// The photograph sees only what stands above the water: the hull is clipped at the waterline (y = 0).
renderer.localClippingEnabled = true;
const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)] });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
// One built ship per draught tried (the hull floats at the draught the fit is testing).
const shipsByDraught = new Map<number, ShipModel>();
let shownShip: ShipModel | null = null;

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function showShip(draughtMetres: number) {
  const key = Math.round(draughtMetres * 20) / 20;
  let ship = shipsByDraught.get(key);
  if (!ship) {
    ship = buildShip({ kind: "tanker", lengthMetres: EAGLE_S_LENGTH_METRES, tone: "suspect", isDetailed: false, draughtMetres: key });
    addShipDetail(ship, null);
    ship.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material = silhouetteMaterial;
    });
    shipsByDraught.set(key, ship);
  }
  if (shownShip !== ship) {
    if (shownShip) scene.remove(shownShip.group);
    scene.add(ship.group);
    shownShip = ship;
  }
}

/** Draws the silhouette at the masks' size and returns its mask, row 0 at the top. */
function renderMask(camera: PhotoCamera, width: number, height: number): Uint8Array {
  showShip(camera.draughtMetres);
  const pose = readCameraPose(camera, width / height);
  renderer.setSize(width, height, false);
  const target = new THREE.WebGLRenderTarget(width, height);
  renderer.setRenderTarget(target);
  renderer.render(scene, pose);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = height - 1 - row;
    for (let column = 0; column < width; column += 1) mask[row * width + column] = (pixels[(sourceRow * width + column) * 4] ?? 0) > 127 ? 1 : 0;
  }
  return mask;
}

function scoreMask(model: Uint8Array, photo: Masks): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < model.length; index += 1) {
    if (photo.voidMask[index] === 1) continue;
    const isModel = model[index] === 1;
    const isPhoto = photo.ship[index] === 1;
    if (isModel && isPhoto) intersection += 1;
    if (isModel || isPhoto) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}

/** The mask's extent: its leftmost and rightmost columns and its lowest row (-1 when empty). */
function measureMask(mask: Uint8Array, width: number, height: number): { left: number; right: number; bottom: number } {
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (mask[row * width + column] !== 1) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
      bottom = Math.max(bottom, row);
    }
  }
  return { left, right, bottom };
}

Object.assign(window, {
  photoMatchMeasure(camera: PhotoCamera, width: number, height: number) {
    return measureMask(renderMask(camera, width, height), width, height);
  },
  photoMatchLoadMasks(width: number, height: number, shipBase64: string, voidBase64: string) {
    masks = { width, height, ship: decodeBase64(shipBase64), voidMask: decodeBase64(voidBase64) };
  },
  photoMatchScore(camera: PhotoCamera): number {
    if (!masks) return 0;
    return scoreMask(renderMask(camera, masks.width, masks.height), masks);
  },
  photoMatchRender(camera: PhotoCamera, width: number, height: number): string {
    return encodeBase64(renderMask(camera, width, height));
  },
});
document.body.dataset.state = "ready";
