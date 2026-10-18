import * as THREE from "three";
import { createSeededRandom } from "@/lib/seabed/math";
import type { ShipModel } from "@/lib/ships/build-ship";
import { buildHullPatch, buildRailings, readDeckHeight, readHalfBreadth, readKeelHeight, type HullForm } from "@/lib/ships/hull-form";
import { SHIP_PAINT } from "@/lib/ships/ship-paint";
import { addBox, addCylinder, addPipe, addRoundedBox, createShipParts, mergeParts, readDeckHalfWidth, readDeckY, type HouseLayout, type HouseLevel, type ShipParts } from "@/lib/ships/ship-parts";

// The ship's detail level, added after the first frame (the overview loads this module with a dynamic import, so its
// code is not on the first frame's path): windows one by one on every level of the house, handrails along the decks
// and the house's open decks, enclosed lifeboats in their davits, radar scanners and antennas on the mast, the
// accommodation ladder, the propeller and rudder under the counter, and the paint marks that make a hull a particular
// ship: its name on the bow, draught marks fore and aft, and rust washed down from the hawse pipes and scuppers.

// Windows: 1.1 by 0.9 m on a 2.4 m pitch, set 0.05 m proud of the house's face.
const WINDOW_WIDTH = 1.1;
const WINDOW_HEIGHT = 0.9;
const WINDOW_PITCH = 2.4;
// Paint marks are drawn on canvases this many pixels per metre of hull.
const MARK_PIXELS_PER_METRE = 24;
// The marks float this far off the plating so they never fight it for depth.
const MARK_LIFT_METRES = 0.04;
// Fixed seed for the rust streaks (Eagle S's build year and month).
const RUST_SEED = 200606;

/** Windows along one face of a house level: `alongX` true for the side faces (running along the ship). */
function addLevelWindows(parts: ShipParts, level: HouseLevel) {
  const height = level.roofY - level.floorY;
  if (height < 1.8) return;
  const centerY = level.floorY + 0.58 * height;
  const frontCount = Math.max(1, Math.floor((level.width - 1.5) / WINDOW_PITCH));
  for (let index = 0; index < frontCount; index += 1) {
    const offset = (index - (frontCount - 1) / 2) * WINDOW_PITCH;
    addBox(parts.glass, [0.1, WINDOW_HEIGHT, WINDOW_WIDTH], [level.frontX + 0.05, centerY, offset]);
  }
  const sideCount = Math.max(1, Math.floor((level.lengthAlong - 2) / WINDOW_PITCH));
  for (let index = 0; index < sideCount; index += 1) {
    const positionX = level.frontX - 1.2 - index * WINDOW_PITCH;
    for (const side of [-1, 1]) addBox(parts.glass, [WINDOW_WIDTH, WINDOW_HEIGHT, 0.1], [positionX, centerY, side * (level.width / 2 + 0.05)]);
  }
}

/** A rail round the edge of a level's roof (an open deck), front and both sides. */
function addRoofRail(parts: ShipParts, level: HouseLevel) {
  const railY = level.roofY + 1.0;
  const halfWidth = level.width / 2 + 0.2;
  const aftX = level.frontX - level.lengthAlong;
  const corners = [new THREE.Vector3(aftX, railY, -halfWidth), new THREE.Vector3(level.frontX + 0.2, railY, -halfWidth), new THREE.Vector3(level.frontX + 0.2, railY, halfWidth), new THREE.Vector3(aftX, railY, halfWidth)];
  for (let index = 0; index < corners.length - 1; index += 1) {
    const start = corners[index];
    const end = corners[index + 1];
    if (!start || !end) continue;
    addPipe(parts.equipment, [start, end], 0.04, 4);
    const length = start.distanceTo(end);
    for (let step = 0; step <= Math.floor(length / 1.8); step += 1) {
      const post = start.clone().lerp(end, Math.min(1, (step * 1.8) / length));
      addBox(parts.equipment, [0.05, 1.0, 0.05], [post.x, railY - 0.5, post.z]);
    }
  }
}

/** Radar scanners, a whip antenna pair and the mast's light on the bridge's mast. */
function addMastGear(parts: ShipParts, house: HouseLayout, scale: number) {
  const { mast } = house;
  const height = mast.topY - mast.baseY;
  // Two scanners: the X band on the yard, the S band on a stub forward of it.
  addBox(parts.funnel, [0.35, 0.3, 4.2 * scale + 1], [mast.x, mast.baseY + height * 0.62, 0]);
  addBox(parts.funnel, [0.35, 0.3, 5.2 * scale + 1.2], [mast.x + 2.6 * scale, house.bridge.roofY + 1.6, 0]);
  addCylinder(parts.equipment, 0.12, 1.2, [mast.x + 2.6 * scale, house.bridge.roofY + 0.9, 0], "y", 6);
  for (const side of [-1, 1]) addCylinder(parts.equipment, 0.04, 3.5 * scale + 1, [mast.x - 1, house.bridge.roofY + 2, side * house.bridge.width * 0.3], "y", 4);
  addCylinder(parts.band, 0.18, 0.4, [mast.x, mast.topY + 0.2, 0], "y", 8);
}

/** Enclosed lifeboats in gravity davits, one on each side of the house's second level, aft. */
function addLifeboats(parts: ShipParts, form: HullForm, house: HouseLayout) {
  const level = house.levels[1] ?? house.levels[0];
  if (!level) return;
  const boatLength = Math.min(8.5, 0.035 * form.lengthMetres + 1);
  const boatX = level.frontX - level.lengthAlong * 0.55;
  const boatY = level.floorY + 1.4;
  for (const side of [-1, 1]) {
    const boatZ = side * (level.width / 2 + 1.6);
    addRoundedBox(parts.lifeboat, [boatLength, 1.5, 2.6], [boatX, boatY, boatZ], 1.0);
    addRoundedBox(parts.lifeboat, [boatLength * 0.62, 0.9, 2.0], [boatX - 0.3, boatY + 1.0, boatZ], 0.45);
    // The davit arms either end.
    for (const end of [-1, 1]) addBox(parts.equipment, [0.25, 3.4, 0.25], [boatX + end * boatLength * 0.42, boatY + 0.8, side * (level.width / 2 + 0.6)], new THREE.Euler(side * 0.35, 0, 0));
  }
}

/** The accommodation ladder stowed along the starboard side, sloping down aft from the deck (Eagle S carries one amidships aft). */
function addAccommodationLadder(parts: ShipParts, form: HullForm) {
  const topX = form.bowX - 0.63 * form.lengthMetres;
  const length = 0.06 * form.lengthMetres;
  const topY = readDeckY(form, topX) - 0.3;
  const slope = 0.62;
  const halfBreadth = readHalfBreadth(form, topX, readDeckHeight(form, topX) - 3);
  addBox(parts.equipment, [length, 0.25, 0.9], [topX - (length / 2) * Math.cos(slope), topY - (length / 2) * Math.sin(slope), halfBreadth + 0.5], new THREE.Euler(0, 0, slope));
}

/** A four-bladed propeller and a spade rudder under the counter (seen through the water on the GPU tiers). */
function addPropellerAndRudder(parts: ShipParts, form: HullForm) {
  const propellerRadius = 0.32 * form.draught;
  const propellerX = form.rudderPostX + 0.4 * propellerRadius + 1;
  const propellerY = readKeelHeight(form, propellerX) - form.draught - propellerRadius * 1.05;
  addCylinder(parts.equipment, 0.12 * propellerRadius, 0.5 * propellerRadius, [propellerX, propellerY, 0], "x", 10);
  for (let blade = 0; blade < 4; blade += 1) {
    const angle = (blade / 4) * Math.PI * 2 + 0.4;
    addBox(parts.equipment, [0.12, propellerRadius * 0.9, propellerRadius * 0.42], [propellerX, propellerY + Math.cos(angle) * propellerRadius * 0.5, Math.sin(angle) * propellerRadius * 0.5], new THREE.Euler(angle, 0, 0.35));
  }
  const rudderHeight = 0.62 * form.draught;
  addBox(parts.funnel, [0.11 * form.draught, rudderHeight, 0.5], [form.rudderPostX - 1.2, propellerY + 0.1 * rudderHeight, 0]);
}

/** A canvas texture, or null outside a browser. */
function createMarkCanvas(widthMetres: number, heightMetres: number, draw: (context: CanvasRenderingContext2D, width: number, height: number) => void): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(2048, Math.max(16, Math.round(widthMetres * MARK_PIXELS_PER_METRE)));
  canvas.height = Math.min(1024, Math.max(16, Math.round(heightMetres * MARK_PIXELS_PER_METRE)));
  const context = canvas.getContext("2d");
  if (!context) return null;
  draw(context, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A mark painted on the hull's side between two stations and heights, both sides of the ship, mirrored to read. */
function addHullMark(group: THREE.Group, form: HullForm, area: { fromX: number; toX: number; fromHeight: number; toHeight: number }, texture: THREE.Texture, roughness: number) {
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const side of [1, -1] as const) {
    const mesh = new THREE.Mesh(buildHullPatch(form, { ...area, side, liftMetres: MARK_LIFT_METRES }), material);
    mesh.renderOrder = 1;
    group.add(mesh);
  }
}

/** The ship's name on both bows, in white capitals about 2.4 m high under the forecastle. */
function addBowName(group: THREE.Group, form: HullForm, name: string) {
  const letterMetres = Math.min(2.6, 0.011 * form.lengthMetres + 0.2);
  const widthMetres = letterMetres * 0.75 * name.length + letterMetres;
  const toX = form.halfLength - 0.025 * form.lengthMetres;
  const fromX = toX - widthMetres;
  const topHeight = readDeckHeight(form, toX) - 0.8;
  const texture = createMarkCanvas(widthMetres, letterMetres * 1.4, (context, width, height) => {
    context.fillStyle = SHIP_PAINT.marking;
    context.font = `600 ${Math.round(height * 0.72)}px sans-serif`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillText(name.toUpperCase(), width / 2, height / 2);
  });
  if (texture) addHullMark(group, form, { fromX, toX, fromHeight: topHeight - letterMetres * 1.4, toHeight: topHeight }, texture, 0.5);
}

/** Draught marks: white numerals every metre from the keel up past the waterline, near the stem and at the stern. */
function addDraughtMarks(group: THREE.Group, form: HullForm) {
  const heightMetres = form.depth * 0.85;
  const texture = createMarkCanvas(1.6, heightMetres, (context, width, height) => {
    context.fillStyle = SHIP_PAINT.marking;
    const pixelsPerMetre = height / heightMetres;
    context.font = `600 ${Math.round(pixelsPerMetre * 0.5)}px sans-serif`;
    context.textAlign = "center";
    for (let metre = 2; metre < heightMetres; metre += 2) {
      const row = height - metre * pixelsPerMetre;
      context.fillText(`${metre}M`, width / 2, row);
    }
  });
  if (!texture) return;
  for (const atX of [form.halfLength - 0.04 * form.lengthMetres, -form.halfLength + 0.03 * form.lengthMetres]) addHullMark(group, form, { fromX: atX - 0.8, toX: atX + 0.8, fromHeight: 0.5, toHeight: 0.5 + heightMetres }, texture, 0.5);
}

/** Rust washed down the topsides: long streaks under the hawse pipe and short ones under the deck's scuppers. */
function addRustStreaks(group: THREE.Group, form: HullForm) {
  const nextRandom = createSeededRandom(RUST_SEED);
  const fromX = -form.halfLength + 0.08 * form.lengthMetres;
  const toX = form.halfLength - 0.06 * form.lengthMetres;
  const deckHeight = readDeckHeight(form, 0);
  const streakHeight = deckHeight - form.draught - 0.6;
  const texture = createMarkCanvas(toX - fromX, streakHeight, (context, width, height) => {
    const pixelsPerMetre = width / (toX - fromX);
    for (let positionMetres = 4; positionMetres < toX - fromX; positionMetres += 6 + nextRandom() * 9) {
      const column = positionMetres * pixelsPerMetre;
      const length = height * (0.15 + nextRandom() * 0.45);
      const gradient = context.createLinearGradient(0, 0, 0, length);
      gradient.addColorStop(0, `${SHIP_PAINT.rust}B0`);
      gradient.addColorStop(1, `${SHIP_PAINT.rust}00`);
      context.fillStyle = gradient;
      context.fillRect(column, 0, 1 + nextRandom() * 3, length);
    }
    // The hawse pipe's long stain, at the forward end.
    const hawseColumn = width - 0.02 * form.lengthMetres * pixelsPerMetre;
    const hawseGradient = context.createLinearGradient(0, 0, 0, height);
    hawseGradient.addColorStop(0, `${SHIP_PAINT.rust}C8`);
    hawseGradient.addColorStop(1, `${SHIP_PAINT.rust}00`);
    context.fillStyle = hawseGradient;
    context.fillRect(hawseColumn - 6, height * 0.05, 12, height * 0.9);
  });
  if (texture) addHullMark(group, form, { fromX, toX, fromHeight: form.draught + 0.6, toHeight: deckHeight - 0.05 }, texture, 0.85);
}

/**
 * Adds the detail level to a ship built by buildShip: one merged mesh per paint plus the paint marks, in a group the
 * caller can hide when the ship is far away. `name` is painted on the bows (null for none).
 */
export function addShipDetail(model: ShipModel, name: string | null): THREE.Group {
  const { form, house, materials } = model;
  const parts = createShipParts();
  const scale = Math.max(0.35, Math.min(1, form.lengthMetres / 228));
  if (house) {
    house.levels.forEach((level) => addLevelWindows(parts, level));
    house.levels.slice(1).forEach((level) => addRoofRail(parts, level));
    addMastGear(parts, house, scale);
    if (house.withLifeboats) addLifeboats(parts, form, house);
  }
  parts.equipment.push(...buildRailings(form, -form.halfLength + 2, form.forecastleStartX));
  if (form.lengthMetres > 90) addAccommodationLadder(parts, form);
  addPropellerAndRudder(parts, form);
  // Scupper and fairlead fittings along the deck edge every 12 m.
  for (let positionX = -form.halfLength + 6; positionX < form.halfLength - 6; positionX += 12) {
    for (const side of [-1, 1]) addBox(parts.equipment, [0.6, 0.35, 0.3], [positionX, readDeckY(form, positionX) - 0.4, side * (readDeckHalfWidth(form, positionX) + 0.05)]);
  }
  const detail = new THREE.Group();
  detail.name = "ship-detail";
  const meshes = [
    new THREE.Mesh(mergeParts(parts.equipment), materials.equipment),
    new THREE.Mesh(mergeParts(parts.glass), materials.glass),
    new THREE.Mesh(mergeParts(parts.funnel), materials.funnel),
    new THREE.Mesh(mergeParts(parts.band), materials.band),
    new THREE.Mesh(mergeParts(parts.lifeboat), materials.lifeboat),
  ];
  meshes.forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    detail.add(mesh);
  });
  if (name) addBowName(detail, form, name);
  addDraughtMarks(detail, form);
  addRustStreaks(detail, form);
  model.group.add(detail);
  return detail;
}
