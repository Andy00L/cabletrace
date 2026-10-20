import * as THREE from "three";
import type { ShipKind } from "@/lib/replay/replay-scene";
import { clampValue, createSeededRandom } from "@/lib/seabed/math";
import { readHalfBreadth, type HullForm } from "@/lib/ships/hull-form";
import { addBox, addCylinder, addPipe, addSlopedBeam, readDeckHalfWidth, readDeckY, type PartList, type ShipParts } from "@/lib/ships/ship-parts";

// The deck of each ship type: the gear that makes a tanker read as a tanker from a kilometre away. Sizes follow the
// hull: `along` scales lengths from a 228 m reference hull, `across` scales widths from its 32.2 m beam, and fixed
// fittings (pipes, rails) keep their real size. The details are the ones visible on any such ship, not a survey of one.

const REFERENCE_HALF_LENGTH = 114;
const REFERENCE_HALF_BEAM = 16.1;
// Container sizes: 40 ft bays (12.2 m) with a 1.4 m lashing gap, 2.44 m wide boxes on a 2.5 m row pitch, tiers of
// 2.59 m (ISO 668).
const CONTAINER_BAY_LENGTH = 12.2;
const CONTAINER_BAY_GAP = 1.4;
const CONTAINER_ROW_PITCH = 2.5;
const CONTAINER_WIDTH = 2.44;
const CONTAINER_TIER_HEIGHT = 2.59;
// Fixed seed so the stack skyline is identical on every load (the Balticconnector damage date).
const CONTAINER_LAYOUT_SEED = 20231008;
// Box colours, a small fixed set: the hues lines' boxes carry (blue, red, green, sand, white, grey), each dulled toward
// grey so no box can pass for a data colour (cable blue, pipeline amber, alarm red: docs/UI_DESIGN_SYSTEM.md, Data).
const CONTAINER_COLORS: readonly THREE.Color[] = ["#6E7C8C", "#8C6A62", "#6F7F6E", "#A89A80", "#C9C6BE", "#85878A", "#5F6670"].map((hex) => new THREE.Color(hex));

/** A box whose vertices carry one colour (drawn by the ship's vertex-coloured material). */
function addPaintedBox(parts: PartList, size: [number, number, number], center: [number, number, number], color: THREE.Color) {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(...center);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  const colors = new Float32Array(flat.getAttribute("position").count * 3);
  for (let vertex = 0; vertex < colors.length / 3; vertex += 1) color.toArray(colors, vertex * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  parts.push(flat);
}

export type DeckFrame = { form: HullForm; along: number; across: number; deckY: number; cargoStartX: number; cargoEndX: number };

export function createDeckFrame(form: HullForm, cargoStartX: number, cargoEndX: number): DeckFrame {
  return { form, along: form.halfLength / REFERENCE_HALF_LENGTH, across: form.halfBeam / REFERENCE_HALF_BEAM, deckY: readDeckY(form, 0), cargoStartX, cargoEndX };
}

/** A point on the hull at a share of the length overall measured from the stem (Eagle S's photograph is read that way). */
function readXFromBow(form: HullForm, shareFromBow: number): number {
  return form.bowX - shareFromBow * form.lengthMetres;
}

/**
 * An Aframax crude tanker's deck, laid out after Eagle S's side photograph (ship-specs.ts): the cargo pipes in a rack
 * down the centreline under a raised catwalk, the manifold across the beam a little forward of amidships with a hose
 * crane whose horizontal jib reaches forward over it and a small control house under it, kingposts with deck lights at
 * 27%, 54% and 70% of the length from the stem, P/V valve risers and tank hatches in two rows.
 */
function buildTankerDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY, along, across, cargoStartX: rackStart, cargoEndX: rackEnd } = frame;
  const rackLength = rackEnd - rackStart;
  const rackCenter = (rackStart + rackEnd) / 2;
  // The cargo pipes: six lines of 0.25 to 0.4 m on supports 1.2 m high, the catwalk over them 3 m up.
  const pipeOffsets: readonly [number, number][] = [
    [-1.5, 0.3],
    [-0.8, 0.38],
    [0, 0.4],
    [0.8, 0.36],
    [1.5, 0.3],
    [2.2, 0.25],
  ];
  for (const [offset, radius] of pipeOffsets) addCylinder(parts.pipes, radius * across, rackLength, [rackCenter, deckY + 1.2 + radius, offset * across], "x", 8);
  addBox(parts.equipment, [rackLength, 0.12, 1.1], [rackCenter, deckY + 3.0, -0.2 * across]);
  for (let positionX = rackStart + 2; positionX < rackEnd; positionX += 6 * along) {
    addBox(parts.equipment, [0.25, 3.0, 0.25], [positionX, deckY + 1.5, -0.2 * across - 0.5]);
    addBox(parts.equipment, [0.25, 1.2, 4.6 * across], [positionX, deckY + 0.6, 0.35 * across]);
  }
  // The catwalk's handrails.
  for (const side of [-1, 1]) addCylinder(parts.equipment, 0.04, rackLength, [rackCenter, deckY + 4.0, -0.2 * across + side * 0.55], "x", 4);
  // Along each side: the spill coaming at the deck edge and the fire main on its supports inside it, the low band of
  // gear the photograph shows over the whole cargo deck.
  for (const side of [-1, 1]) {
    addBox(parts.equipment, [rackLength, 0.35, 0.12], [rackCenter, deckY + 0.175, side * (readDeckHalfWidth(form, rackCenter) - 0.6)]);
    addCylinder(parts.pipes, 0.22, rackLength, [rackCenter, deckY + 0.75, side * (readDeckHalfWidth(form, rackCenter) - 1.4)], "x", 6);
  }
  // The manifold: crossover pipes from the rack out to both sides, with valves and drip trays at the rail.
  const manifoldX = readXFromBow(form, 0.47);
  for (const offset of [-2.4, -0.8, 0.8, 2.4]) {
    const pipeX = manifoldX + offset * along;
    addCylinder(parts.pipes, 0.32 * across, 2 * readDeckHalfWidth(form, pipeX) - 2, [pipeX, deckY + 1.6, 0], "z", 8);
    for (const side of [-1, 1]) addBox(parts.equipment, [0.9, 0.9, 0.9], [pipeX, deckY + 1.6, side * (readDeckHalfWidth(form, pipeX) - 3)]);
  }
  for (const side of [-1, 1]) addBox(parts.equipment, [11 * along, 0.4, 2.2], [manifoldX, deckY + 0.2, side * (readDeckHalfWidth(form, manifoldX) - 1.6)]);
  // The hose crane, as the photograph shows it (shares of the length from the stem): its control house on the deck
  // from 43.1% to 45.6%, 3.6 m high, the crane pillar rising out of it at 44.5%, a pair of lattice posts at 43%, a level
  // jib 1.3 m deep about 7.6 m over the deck from 39.5% to 50.8%, a block hanging 2.8 m under its aft end and a strut
  // from the jib down to that block.
  const controlHouseFore = readXFromBow(form, 0.431);
  const controlHouseAft = readXFromBow(form, 0.456);
  const controlHouseHeight = 3.6 * along;
  const jibForeX = readXFromBow(form, 0.395);
  const jibAftX = readXFromBow(form, 0.508);
  const jibY = deckY + 7.6 * along;
  const jibDepth = 1.3 * along;
  addBox(parts.structure, [controlHouseFore - controlHouseAft, controlHouseHeight, 4.4 * across], [(controlHouseFore + controlHouseAft) / 2, deckY + controlHouseHeight / 2, 0]);
  const pillarX = readXFromBow(form, 0.445);
  const pillarFootY = deckY + controlHouseHeight;
  addBox(parts.structure, [1.4 * along, jibY - pillarFootY, 1.4 * along], [pillarX, (pillarFootY + jibY) / 2, 0]);
  addBox(parts.structure, [2.6 * along, 2.6 * along, 2.4 * along], [pillarX, jibY + 0.5 * along, 0]);
  const postX = readXFromBow(form, 0.43);
  for (const side of [-1, 1]) addCylinder(parts.equipment, 0.25 * along, jibY - deckY, [postX, deckY + (jibY - deckY) / 2, side * 1.2 * across], "y", 6);
  // The jib rises about 1 m from its forward tip to its aft end.
  const jibRise = Math.atan2(1.0 * along, jibForeX - jibAftX);
  addBox(parts.structure, [jibForeX - jibAftX, jibDepth, 0.9 * along], [(jibForeX + jibAftX) / 2, jibY, 0], new THREE.Euler(0, 0, -jibRise));
  const blockHeight = 2.8 * along;
  addBox(parts.structure, [1.2 * along, blockHeight, 1.0 * along], [jibAftX + 0.6 * along, jibY - jibDepth / 2 - blockHeight / 2 + 0.2, 0]);
  addPipe(parts.structure, [new THREE.Vector3(readXFromBow(form, 0.483), jibY - jibDepth / 2, 0), new THREE.Vector3(jibAftX + 1.0 * along, jibY - jibDepth / 2 - blockHeight + 0.4, 0)], 0.25 * along + 0.05, 6);
  // Kingposts with deck lights.
  for (const share of [0.275, 0.54, 0.705]) {
    const postX = readXFromBow(form, share);
    const postHeight = 5.6 * along + 0.5;
    addCylinder(parts.structure, 0.32 * along + 0.08, postHeight, [postX, deckY + postHeight / 2, -2.6 * across], "y", 8, 0.22 * along + 0.06);
    addBox(parts.equipment, [0.5, 0.35, 1.6], [postX, deckY + postHeight, -2.6 * across]);
  }
  // Tank hatches and P/V valve risers in two rows, one pair per cargo tank.
  for (let positionX = rackStart + 8 * along; positionX < rackEnd - 6 * along; positionX += 17 * along) {
    for (const side of [-1, 1]) {
      addCylinder(parts.equipment, 0.9 * across, 0.8, [positionX, deckY + 0.4, side * 8.5 * across], "y", 12);
      addCylinder(parts.pipes, 0.18, 3.2, [positionX + 3 * along, deckY + 1.6, side * 6.2 * across], "y", 6);
      addCylinder(parts.equipment, 0.32, 0.5, [positionX + 3 * along, deckY + 3.4, side * 6.2 * across], "y", 8);
    }
  }
}

/** Seven hatch coamings with their covers (a Panamax layout), and the cover rails out to both sides. */
function buildBulkCarrierDeck(frame: DeckFrame, parts: ShipParts) {
  const { deckY, along, across, cargoStartX, cargoEndX } = frame;
  const hatchCount = Math.max(3, Math.round(7 * along));
  const holdLength = (cargoEndX - cargoStartX) / hatchCount;
  const hatchLength = holdLength * 0.72;
  const hatchWidth = 15 * across;
  for (let hold = 0; hold < hatchCount; hold += 1) {
    const centerX = cargoStartX + holdLength * (hold + 0.5);
    addBox(parts.equipment, [hatchLength, 1.9, hatchWidth], [centerX, deckY + 0.95, 0]);
    addBox(parts.structure, [hatchLength + 0.8, 0.7, hatchWidth + 0.8], [centerX, deckY + 2.25, 0]);
    addBox(parts.structure, [hatchLength + 0.8, 0.3, hatchWidth * 0.45], [centerX, deckY + 2.75, 0]);
    for (const side of [-1, 1]) addBox(parts.equipment, [0.4, 0.5, 5.5 * across], [centerX + side * (hatchLength / 2 - 1), deckY + 0.25, 0.5 * side * (hatchWidth + 5.5 * across)]);
  }
}

/** Three long holds under folding covers, panel joints across each, and two side-deck cranes with stowed jibs. */
function buildGeneralCargoDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY, along, cargoStartX, cargoEndX } = frame;
  const holdCount = 3;
  const holdPitch = (cargoEndX - cargoStartX) / holdCount;
  for (let hold = 0; hold < holdCount; hold += 1) {
    const aftX = cargoStartX + hold * holdPitch + 2 * along;
    const foreX = aftX + holdPitch - 6 * along;
    const length = foreX - aftX;
    const centerX = (aftX + foreX) / 2;
    const width = Math.min(20 * frame.across, 2 * (readHalfBreadth(form, foreX, form.depth) - 4 * frame.across));
    addBox(parts.equipment, [length, 1.5, width], [centerX, deckY + 0.75, 0]);
    addBox(parts.structure, [length + 0.6, 0.8, width + 0.6], [centerX, deckY + 1.9, 0]);
    const panelCount = Math.max(2, Math.round(length / 9));
    for (let joint = 1; joint < panelCount; joint += 1) addBox(parts.equipment, [0.35, 0.25, width + 0.6], [aftX + (length * joint) / panelCount, deckY + 2.4, 0]);
  }
  const cranes: { positionX: number; side: 1 | -1; direction: 1 | -1 }[] = [
    { positionX: cargoStartX + holdPitch, side: -1, direction: 1 },
    { positionX: cargoStartX + 2 * holdPitch, side: 1, direction: -1 },
  ];
  const pedestalHeight = 9 * along;
  const jibLength = 26 * along;
  for (const { positionX, side, direction } of cranes) {
    const sideZ = side * Math.min(12.6 * frame.across, readDeckHalfWidth(form, positionX) - 2);
    addCylinder(parts.equipment, 1.7 * along, pedestalHeight, [positionX, deckY + pedestalHeight / 2, sideZ], "y", 14);
    addBox(parts.structure, [5 * along, 4 * along, 4.4 * along], [positionX, deckY + pedestalHeight + 2 * along, sideZ]);
    const pivot: [number, number, number] = [positionX + direction * 1.8 * along, deckY + pedestalHeight + 1.2 * along, sideZ];
    addSlopedBeam(parts.equipment, pivot, jibLength, 0.16, direction, 1.1 * along);
    const headX = pivot[0] + direction * jibLength * Math.cos(0.16);
    const headY = pivot[1] - jibLength * Math.sin(0.16);
    addBox(parts.equipment, [0.5, headY - deckY, 0.5], [headX - direction * 1.2, deckY + (headY - deckY) / 2, sideZ]);
  }
}

/** Container stacks in 40 ft bays, two tones mixed so single boxes read, between lashing bridges; lower to the bow. */
function buildContainerShipDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY, cargoStartX, cargoEndX } = frame;
  const nextRandom = createSeededRandom(CONTAINER_LAYOUT_SEED);
  const bayPitch = CONTAINER_BAY_LENGTH + CONTAINER_BAY_GAP;
  const bayCount = Math.floor((cargoEndX - cargoStartX) / bayPitch);
  for (let bay = 0; bay < bayCount; bay += 1) {
    const aftX = cargoStartX + bay * bayPitch;
    const centerX = aftX + CONTAINER_BAY_LENGTH / 2;
    const usableHalfWidth = Math.min(readDeckHalfWidth(form, aftX), readDeckHalfWidth(form, aftX + CONTAINER_BAY_LENGTH)) - 1.5;
    const rowCount = Math.max(2, Math.floor((2 * usableHalfWidth) / CONTAINER_ROW_PITCH));
    const stackWidth = rowCount * CONTAINER_ROW_PITCH;
    addBox(parts.equipment, [CONTAINER_BAY_LENGTH, 1.2, stackWidth], [centerX, deckY + 0.6, 0]);
    addBox(parts.equipment, [0.5, 2 * CONTAINER_TIER_HEIGHT, stackWidth + 0.6], [aftX - CONTAINER_BAY_GAP / 2, deckY + 1.2 + CONTAINER_TIER_HEIGHT, 0]);
    const bowAmount = clampValue((centerX - 0.26 * form.halfLength) / (cargoEndX - 0.26 * form.halfLength), 0, 1);
    const tallestTiers = bowAmount > 0.55 ? 2 : bowAmount > 0 ? 3 : 4;
    for (let row = 0; row < rowCount; row += 1) {
      const rowZ = -stackWidth / 2 + CONTAINER_ROW_PITCH * (row + 0.5);
      const tiers = Math.max(1, tallestTiers - (nextRandom() < 0.3 ? 1 : 0));
      for (let tier = 0; tier < tiers; tier += 1) {
        const color = CONTAINER_COLORS[Math.floor(nextRandom() * CONTAINER_COLORS.length)] ?? CONTAINER_COLORS[0];
        // 5 cm shorter than the tier pitch so each box shows a seam above it.
        addPaintedBox(parts.painted, [CONTAINER_BAY_LENGTH - 0.2, CONTAINER_TIER_HEIGHT - 0.05, CONTAINER_WIDTH], [centerX, deckY + 1.2 + CONTAINER_TIER_HEIGHT * (tier + 0.5), rowZ], color);
      }
    }
  }
}

/** A stern trawler's gantry (an A-frame over the stern ramp), trawl winches, the net drum and a mast with booms. */
function buildFishingDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY } = frame;
  const sternX = -form.halfLength;
  const halfWidth = readDeckHalfWidth(form, sternX + 2);
  const gantryHeight = 0.55 * form.depth + 3;
  for (const side of [-1, 1]) addBox(parts.equipment, [0.5, gantryHeight, 0.5], [sternX + 1.5, deckY + gantryHeight / 2, side * halfWidth * 0.8], new THREE.Euler(0, 0, -0.12));
  addBox(parts.equipment, [0.6, 0.6, halfWidth * 1.7], [sternX + 1.5 - gantryHeight * 0.06, deckY + gantryHeight, 0]);
  // The stern ramp: a slot down the middle of the transom.
  addBox(parts.equipment, [0.12 * form.lengthMetres, 0.2, halfWidth * 0.6], [sternX + 0.06 * form.lengthMetres, deckY - 0.4, 0], new THREE.Euler(0, 0, 0.22));
  addCylinder(parts.equipment, 1.0, halfWidth * 1.1, [sternX + 0.22 * form.lengthMetres, deckY + 1.1, 0], "z", 14);
  for (const side of [-1, 1]) addCylinder(parts.equipment, 0.7, 1.6, [-0.05 * form.halfLength, deckY + 0.8, side * halfWidth * 0.5], "z", 12);
  const mastX = 0.18 * form.halfLength;
  const mastHeight = 0.7 * form.depth + 5;
  addCylinder(parts.equipment, 0.22, mastHeight, [mastX, deckY + mastHeight / 2, 0], "y", 8);
  addSlopedBeam(parts.equipment, [mastX, deckY + mastHeight * 0.8, 0], 0.22 * form.lengthMetres, 0.5, -1, 0.18);
}

/** A tug's towing winch and staple on the low aft deck, a thick bow fender and rubbing fenders along both sides. */
function buildTugDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY } = frame;
  const aftX = -0.55 * form.halfLength;
  const halfWidth = readDeckHalfWidth(form, aftX);
  addCylinder(parts.equipment, 0.9, halfWidth * 0.9, [aftX + 0.15 * form.halfLength, deckY + 1.0, 0], "z", 14);
  // The towing staple: an arch over the aft deck that keeps the line off the deck gear.
  const stapleHeight = 3.2;
  for (const side of [-1, 1]) addBox(parts.equipment, [0.35, stapleHeight, 0.35], [aftX - 0.15 * form.halfLength, deckY + stapleHeight / 2, side * halfWidth * 0.75]);
  addBox(parts.equipment, [0.4, 0.4, halfWidth * 1.55], [aftX - 0.15 * form.halfLength, deckY + stapleHeight, 0]);
  addBox(parts.equipment, [0.8, 1.0, 0.8], [-form.halfLength + 2, deckY + 0.5, 0]);
  // Bow fender: a fat rubber pad around the stem; side fenders: a band along the sheer line.
  const fender = new THREE.CapsuleGeometry(0.75, form.halfBeam * 1.2, 4, 10);
  fender.rotateX(Math.PI / 2);
  fender.translate(form.halfLength + form.stemRake * 0.6 - 0.4, deckY - 0.7, 0);
  parts.funnel.push(fender.toNonIndexed());
  fender.dispose();
  for (const side of [-1, 1]) addCylinder(parts.funnel, 0.35, 1.6 * form.halfLength, [0, deckY - 0.5, side * (form.halfBeam + 0.15)], "x", 8);
}

/** A ro-ro's enclosed vehicle decks from stern to bridge, vents on the roof, and the stern door. */
function buildRoRoDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY } = frame;
  const fromX = -form.halfLength + 1;
  const toX = 0.74 * form.halfLength;
  const enclosedHeight = 0.12 * form.lengthMetres;
  const halfWidth = readDeckHalfWidth(form, 0) * 0.98;
  addBox(parts.structure, [toX - fromX, enclosedHeight, halfWidth * 2], [(fromX + toX) / 2, deckY + enclosedHeight / 2, 0]);
  addBox(parts.equipment, [0.4, enclosedHeight * 0.72, halfWidth * 1.1], [fromX - 0.25, deckY + enclosedHeight * 0.38, 0]);
  for (let ventX = fromX + 10; ventX < toX - 8; ventX += 14) {
    for (const side of [-1, 1]) addBox(parts.equipment, [2.4, 1.6, 1.6], [ventX, deckY + enclosedHeight + 0.8, side * halfWidth * 0.75]);
  }
}

/** A ferry's lifeboats hung in davits along both sides of the superstructure. */
function buildPassengerDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY } = frame;
  const boatLength = Math.min(11, 0.05 * form.lengthMetres + 2);
  const boatDeckY = deckY + 3 * 2.9 + 1.2;
  for (let boatX = -0.5 * form.halfLength; boatX < 0.45 * form.halfLength; boatX += boatLength * 1.6) {
    for (const side of [-1, 1]) {
      const boat = new THREE.CapsuleGeometry(boatLength * 0.17, boatLength * 0.66, 4, 10);
      boat.rotateZ(Math.PI / 2);
      boat.translate(boatX, boatDeckY, side * (readDeckHalfWidth(form, boatX) + 0.6));
      parts.lifeboat.push(boat.toNonIndexed());
      boat.dispose();
    }
  }
}

/** A cable layer's bow sheave over the stem, stern sheave in an A-frame, cable tanks amidships and a deck crane. */
function buildCableLayerDeck(frame: DeckFrame, parts: ShipParts) {
  const { form, deckY } = frame;
  const sheaveRadius = 0.022 * form.lengthMetres + 1.2;
  const bowDeckY = readDeckY(form, form.halfLength);
  addCylinder(parts.equipment, sheaveRadius, 1.6, [form.bowX + sheaveRadius * 0.35, bowDeckY + sheaveRadius * 0.2, 0], "z", 24);
  addCylinder(parts.equipment, sheaveRadius * 0.92, 1.2, [-form.halfLength - sheaveRadius * 0.3, deckY + sheaveRadius * 0.3, 0], "z", 24);
  const frameHeight = 0.5 * form.depth + 6;
  const sternHalfWidth = readDeckHalfWidth(form, -form.halfLength + 2);
  for (const side of [-1, 1]) addBox(parts.equipment, [0.6, frameHeight, 0.6], [-form.halfLength + 2, deckY + frameHeight / 2, side * sternHalfWidth * 0.6], new THREE.Euler(0, 0, -0.15));
  addBox(parts.equipment, [0.7, 0.7, sternHalfWidth * 1.3], [-form.halfLength + 2 - frameHeight * 0.075, deckY + frameHeight, 0]);
  const tankRadius = Math.min(0.32 * form.halfBeam * 2, 8);
  for (const tankX of [-0.25 * form.halfLength, 0.15 * form.halfLength]) addCylinder(parts.equipment, tankRadius, 2.4, [tankX, deckY + 1.2, 0], "y", 28);
  addCylinder(parts.equipment, 1.2, 6, [-0.55 * form.halfLength, deckY + 3, readDeckHalfWidth(form, -0.55 * form.halfLength) * 0.6], "y", 12);
  addSlopedBeam(parts.equipment, [-0.55 * form.halfLength, deckY + 6, readDeckHalfWidth(form, -0.55 * form.halfLength) * 0.6], 0.16 * form.lengthMetres, 0.25, 1, 0.8);
}

/** Every ship kind's deck; the record type makes a new kind fail to compile until it has one. */
export const DECK_BUILDERS: Record<ShipKind, (frame: DeckFrame, parts: ShipParts) => void> = {
  tanker: buildTankerDeck,
  "bulk-carrier": buildBulkCarrierDeck,
  "general-cargo": buildGeneralCargoDeck,
  "container-ship": buildContainerShipDeck,
  fishing: buildFishingDeck,
  tug: buildTugDeck,
  "ro-ro": buildRoRoDeck,
  passenger: buildPassengerDeck,
  "cable-layer": buildCableLayerDeck,
};
