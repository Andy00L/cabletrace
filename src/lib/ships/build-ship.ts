import * as THREE from "three";
import type { ShipKind } from "@/lib/replay/replay-scene";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { buildBulwark, buildDeck, buildHullShell, buildTransom, createHullForm, type HullForm, type HullPalette } from "@/lib/ships/hull-form";
import { createDeckFrame, DECK_BUILDERS } from "@/lib/ships/ship-decks";
import { createShipMaterials, TONE_TOPSIDES, type ShipMaterials, type ShipTone } from "@/lib/ships/ship-paint";
import {
  addAccommodationBlock,
  addBox,
  addForecastleGear,
  addFunnel,
  createShipParts,
  DEFAULT_FUNNEL_BAND,
  mergeParts,
  readBridgeFrontX,
  readDeckHalfWidth,
  readDeckY,
  readHawsePoint,
  readTierHeight,
  type FunnelBand,
  type HouseLayout,
  type ShipParts,
} from "@/lib/ships/ship-parts";
import { bakeContactShade, createFloorReader } from "@/lib/ships/ship-shading";
import { SHIP_SPECS } from "@/lib/ships/ship-specs";

// Builds any ship type at its real length: the hull lofted from the type's spec, its plating and paint, the type's
// deck gear and superstructure, in metres with the waterline at y = 0, bow toward +x and starboard toward +z. This is
// the silhouette level, built with the scene; ship-detail.ts adds the detail level (windows, rails, lifeboats, mast
// gear, paint marks, the propeller and rudder) once the first frame is on screen.

export type { ShipTone } from "@/lib/ships/ship-paint";

export type ShipModel = {
  group: THREE.Group;
  /** Stern point at the waterline (metres), where the wake starts. */
  sternLocal: THREE.Vector3;
  /** Bow point at the waterline (metres), where the bow wave rises. */
  bowLocal: THREE.Vector3;
  /** Port hawse pipe (metres), where the anchor chain leaves the hull. */
  hawseLocal: THREE.Vector3;
  form: HullForm;
  kind: ShipKind;
  /** The house the detail level dresses, or null for a ship without one. */
  house: HouseLayout | null;
  materials: ShipMaterials;
};

// From this length up a merchant hull carries its type's full count of accommodation tiers.
const FULL_TIER_LENGTH_METRES = 160;
// Eagle S's stack: the dark panel of its photograph, from 15% to 50% of the stack's height.
const EAGLE_S_FUNNEL_BAND: FunnelBand = { atShare: 0.15, heightShare: 0.35 };
// Window frames: how far the sill, header and mullions stand proud of a house front (m), and the mullions' pitch.
const WINDOW_FRAME_DEPTH_METRES = 0.3;
const MULLION_PITCH_METRES = 2.4;

type BuildShipOptions = {
  kind: ShipKind;
  lengthMetres: number;
  tone: ShipTone;
  isDetailed: boolean;
  /** The draught it floats at (m); the type's design draught when left out. */
  draughtMetres?: number;
  /** The sky's image-based light for the paint's reflections (GPU tiers), or null. */
  sky?: THREE.Texture | null;
};

/** The bridge, accommodation and funnel for the type's placement, and the stretch of deck left for cargo. */
function addSuperstructure(kind: ShipKind, form: HullForm, parts: ShipParts): { cargoStartX: number; cargoEndX: number; house: HouseLayout } {
  const { superstructure } = SHIP_SPECS[kind];
  const frontX = readBridgeFrontX(form, superstructure);
  const deckY = readDeckY(form, 0);
  const length = form.lengthMetres;
  // Merchant hulls under 160 m carry fewer tiers than the type's large ships (an 80 m coaster has two, not four);
  // small craft keep theirs.
  const isMerchantLayout = superstructure.placement === "aft" || superstructure.placement === "full-length";
  const tiers = isMerchantLayout ? Math.max(1, Math.round(superstructure.tiers * Math.min(1, Math.max(0.5, length / FULL_TIER_LENGTH_METRES)))) : superstructure.tiers;
  switch (superstructure.placement) {
    case "aft": {
      const houseLength = superstructure.lengthShare * length;
      // The funnel stands over the engine room, about 9% of the length from the stern on Eagle S, whose stack carries a
      // dark panel low down rather than a light band at the top.
      const funnelX = frontX - houseLength + 0.039 * length;
      const band = kind === "tanker" ? EAGLE_S_FUNNEL_BAND : DEFAULT_FUNNEL_BAND;
      const house = addAccommodationBlock(form, parts, { frontX, lengthAlongShip: houseLength, tiers, baseY: deckY, withLifeboat: true, funnel: { x: funnelX, riseAboveBridge: 0.02 * length, band }, hasPoop: true });
      return { cargoStartX: frontX + 0.012 * length, cargoEndX: 0.8 * form.halfLength - 0.013 * length, house };
    }
    case "forward": {
      const house = addAccommodationBlock(form, parts, { frontX, lengthAlongShip: 0.2 * length, tiers, baseY: deckY, withLifeboat: false, funnel: { x: frontX - 0.24 * length, riseAboveBridge: 0.02 * length, band: DEFAULT_FUNNEL_BAND }, hasPoop: false });
      return { cargoStartX: -0.7 * form.halfLength, cargoEndX: frontX - 0.28 * length, house };
    }
    case "midship": {
      const house = addAccommodationBlock(form, parts, { frontX, lengthAlongShip: 0.26 * length, tiers, baseY: deckY, withLifeboat: false, funnel: { x: frontX - 0.3 * length, riseAboveBridge: 0.02 * length, band: DEFAULT_FUNNEL_BAND }, hasPoop: false });
      return { cargoStartX: -form.halfLength, cargoEndX: frontX - 0.3 * length, house };
    }
    case "full-length": {
      // Ro-ro: the vehicle decks (deck builder) carry the bridge; passenger: cabin decks over most of the length.
      const isRoRo = kind === "ro-ro";
      const baseY = isRoRo ? deckY + 0.12 * length : deckY;
      const blockLength = isRoRo ? 0.1 * length : 0.72 * length;
      const house = addAccommodationBlock(form, parts, { frontX, lengthAlongShip: blockLength, tiers, baseY, withLifeboat: false, funnel: null, hasPoop: false });
      const funnel = addFunnel(form, parts, { x: isRoRo ? -0.55 * form.halfLength : -0.3 * form.halfLength, baseY: isRoRo ? baseY : house.bridge.floorY, topY: house.bridge.roofY + 0.04 * length, width: readDeckHalfWidth(form, 0) * 0.4, band: DEFAULT_FUNNEL_BAND });
      if (!isRoRo) addCabinWindows(form, parts, frontX, blockLength, deckY, tiers);
      return { cargoStartX: -form.halfLength, cargoEndX: frontX, house: { ...house, funnel } };
    }
    default: {
      const unhandled: never = superstructure;
      return unhandled;
    }
  }
}

/** Window bands along both sides of a passenger ship's cabin decks. */
function addCabinWindows(form: HullForm, parts: ShipParts, frontX: number, blockLength: number, deckY: number, tiers: number) {
  const tierHeight = readTierHeight(form);
  const halfWidth = readDeckHalfWidth(form, frontX - blockLength / 2) * 0.84;
  for (let tier = 0; tier < tiers; tier += 1) {
    const depthAlongShip = blockLength * (1 - tier * 0.05);
    const tierHalfWidth = halfWidth * (1 - tier * 0.02);
    const centerY = deckY + tier * tierHeight + tierHeight * 0.55;
    for (const side of [-1, 1]) addBox(parts.glass, [depthAlongShip * 0.94, 0.32 * tierHeight, 0.12], [frontX - tier * 0.15 - depthAlongShip / 2, centerY, side * (tierHalfWidth + 0.06)]);
  }
}

/**
 * The house's window bands on each level's front, set back between a sill and a header that stand proud of the face,
 * with a mullion every 2.4 m, so the band reads as recessed glass in a frame (the silhouette level's windows; the
 * bridge's glazing is on its raked front, ship-parts.ts).
 */
function addHouseGlazing(parts: ShipParts, house: HouseLayout) {
  for (const level of house.levels.slice(1)) {
    const height = level.roofY - level.floorY;
    const bandWidth = level.width * 0.86;
    const bandHeight = 0.34 * height;
    const bandCentreY = level.floorY + 0.55 * height;
    addBox(parts.glass, [0.1, bandHeight, bandWidth], [level.frontX + 0.05, bandCentreY, 0]);
    for (const edge of [-1, 1]) addBox(parts.structure, [WINDOW_FRAME_DEPTH_METRES, 0.16, bandWidth + 0.3], [level.frontX + WINDOW_FRAME_DEPTH_METRES / 2, bandCentreY + edge * (bandHeight / 2 + 0.08), 0]);
    for (let mullionZ = -bandWidth / 2; mullionZ <= bandWidth / 2 + 0.01; mullionZ += MULLION_PITCH_METRES) {
      addBox(parts.structure, [WINDOW_FRAME_DEPTH_METRES * 0.7, bandHeight, 0.14], [level.frontX + WINDOW_FRAME_DEPTH_METRES * 0.35, bandCentreY, mullionZ]);
    }
  }
}

/**
 * Builds one ship at its silhouette level. `isDetailed` adds the plating relief and the paint's roughness (GPU tiers).
 * The viewer frees its GPU memory with the rest of the scene.
 */
export function buildShip(options: BuildShipOptions): ShipModel {
  const { kind, lengthMetres, tone, isDetailed } = options;
  const form = createHullForm(SHIP_SPECS[kind], lengthMetres, options.draughtMetres);
  const toneColors = TONE_TOPSIDES[tone];
  const palette: HullPalette = {
    bottom: new THREE.Color(toneColors.bottom),
    bootTop: new THREE.Color(toneColors.bootTop),
    topside: new THREE.Color(toneColors.topside),
    water: new THREE.Color(SCENE_COLORS.water),
  };
  const materials = createShipMaterials(tone, isDetailed, options.sky ?? null, kind === "tanker");
  const parts = createShipParts();
  const cargo = addSuperstructure(kind, form, parts);
  addHouseGlazing(parts, cargo.house);
  DECK_BUILDERS[kind](createDeckFrame(form, cargo.cargoStartX, cargo.cargoEndX), parts);
  addForecastleGear(form, parts);
  const bulwark = buildBulwark(form);
  // The house, gear, funnel and pipes carry the contact shade in their vertices (ship-shading.ts).
  const readFloorBelow = createFloorReader(form, cargo.house);
  const mergeShaded = (partList: ShipParts[keyof ShipParts]) => {
    const merged = mergeParts(partList);
    bakeContactShade(merged, readFloorBelow);
    return merged;
  };
  const meshes = [
    new THREE.Mesh(buildHullShell(form, palette), materials.hull),
    new THREE.Mesh(buildTransom(form), materials.transom),
    new THREE.Mesh(buildDeck(form), materials.deck),
    ...(bulwark ? [new THREE.Mesh(bulwark, materials.bulwark)] : []),
    new THREE.Mesh(mergeShaded(parts.equipment), materials.equipment),
    new THREE.Mesh(mergeShaded(parts.structure), materials.structure),
    new THREE.Mesh(mergeParts(parts.glass), materials.glass),
    new THREE.Mesh(mergeShaded(parts.funnel), materials.funnel),
    new THREE.Mesh(mergeShaded(parts.band), materials.band),
    new THREE.Mesh(mergeParts(parts.lifeboat), materials.lifeboat),
    new THREE.Mesh(mergeShaded(parts.pipes), materials.pipes),
    new THREE.Mesh(mergeParts(parts.painted), materials.painted),
  ];
  const group = new THREE.Group();
  meshes.forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return {
    group,
    sternLocal: new THREE.Vector3(-form.halfLength, 0, 0),
    bowLocal: new THREE.Vector3(form.halfLength, 0, 0),
    hawseLocal: readHawsePoint(form),
    form,
    kind,
    house: cargo.house,
    materials,
  };
}
