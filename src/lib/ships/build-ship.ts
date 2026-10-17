import * as THREE from "three";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import type { ShipKind } from "@/lib/replay/replay-scene";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { buildDeck, buildHullShell, buildRailings, buildTransom, createHullForm, type HullForm, type HullPalette } from "@/lib/ships/hull-form";
import { createHullPlatingTexture } from "@/lib/ships/hull-plating";
import { createDeckFrame, DECK_BUILDERS } from "@/lib/ships/ship-decks";
import { addAccommodationBlock, addBox, addForecastleGear, addFunnel, createShipParts, mergeParts, readBridgeFrontX, readDeckHalfWidth, readDeckY, readHawsePoint, readTierHeight, type ShipParts } from "@/lib/ships/ship-parts";
import { SHIP_SPECS } from "@/lib/ships/ship-specs";

// Builds any ship type at its real length: the hull lofted from the type's spec, plating, the type's deck gear and
// superstructure, in metres with the waterline at y = 0, bow toward +x and starboard toward +z. Monochrome on purpose:
// the scene's only colours are data colours, so a ship reads through its silhouette (plan, ambition pass 13).

/** `suspect`: the case ship, ink topsides (the suspect's data colour). `context`: any other ship, in the `ship` grey. */
export type ShipTone = "suspect" | "context";

export type ShipModel = {
  group: THREE.Group;
  /** Stern point at the waterline (metres), where the wake starts. */
  sternLocal: THREE.Vector3;
  /** Bow point at the waterline (metres), where the bow wave rises. */
  bowLocal: THREE.Vector3;
  /** Port hawse pipe (metres), where the anchor chain leaves the hull. */
  hawseLocal: THREE.Vector3;
  form: HullForm;
};

// From this length up a merchant hull carries its type's full count of accommodation tiers.
const FULL_TIER_LENGTH_METRES = 160;

type BuildShipOptions = { kind: ShipKind; lengthMetres: number; tone: ShipTone; isDetailed: boolean };

const TONE_TOPSIDES: Record<ShipTone, { topside: string; bootTop: string; bottom: string }> = {
  suspect: { topside: SCENE_COLORS.tankerTopside, bootTop: SCENE_COLORS.tankerBootTop, bottom: SCENE_COLORS.tankerBottom },
  context: { topside: WEBGL_COLORS.ship, bootTop: SCENE_COLORS.tankerTopside, bottom: SCENE_COLORS.tankerBottom },
};

/** The bridge, accommodation and funnel for the type's placement, and the stretch of deck left for cargo. */
function addSuperstructure(kind: ShipKind, form: HullForm, parts: ShipParts): { cargoStartX: number; cargoEndX: number } {
  const spec = SHIP_SPECS[kind];
  const frontX = readBridgeFrontX(form, spec.superstructure);
  const deckY = readDeckY(form, 0);
  const length = form.lengthMetres;
  // Merchant hulls under 160 m carry fewer tiers than the type's large ships (an 80 m coaster has two, not four);
  // small craft keep theirs.
  const isMerchantLayout = spec.superstructure === "aft" || spec.superstructure === "full-length";
  const tiers = isMerchantLayout ? Math.max(1, Math.round(spec.superstructureTiers * Math.min(1, Math.max(0.5, length / FULL_TIER_LENGTH_METRES)))) : spec.superstructureTiers;
  switch (spec.superstructure) {
    case "aft":
      addAccommodationBlock(form, parts, { frontX, lengthAlongShip: 0.075 * length, tiers, baseY: deckY, withLifeboat: true, funnelX: frontX - 0.092 * length });
      return { cargoStartX: frontX + 0.012 * length, cargoEndX: 0.8 * form.halfLength - 0.013 * length };
    case "forward":
      addAccommodationBlock(form, parts, { frontX, lengthAlongShip: 0.2 * length, tiers, baseY: deckY, withLifeboat: false, funnelX: frontX - 0.24 * length });
      return { cargoStartX: -0.7 * form.halfLength, cargoEndX: frontX - 0.28 * length };
    case "midship":
      addAccommodationBlock(form, parts, { frontX, lengthAlongShip: 0.26 * length, tiers, baseY: deckY, withLifeboat: false, funnelX: frontX - 0.3 * length });
      return { cargoStartX: -form.halfLength, cargoEndX: frontX - 0.3 * length };
    case "full-length": {
      // Ro-ro: the vehicle decks (deck builder) carry the bridge; passenger: cabin decks over most of the length.
      const isRoRo = kind === "ro-ro";
      const baseY = isRoRo ? deckY + 0.12 * length : deckY;
      const blockLength = isRoRo ? 0.1 * length : 0.72 * length;
      addAccommodationBlock(form, parts, { frontX, lengthAlongShip: blockLength, tiers, baseY, withLifeboat: false, funnelX: null });
      const topY = baseY + tiers * readTierHeight(form);
      addFunnel(form, parts, isRoRo ? -0.55 * form.halfLength : -0.3 * form.halfLength, isRoRo ? baseY : topY, readDeckHalfWidth(form, 0) * 0.4);
      if (!isRoRo) addCabinWindows(form, parts, frontX, blockLength, deckY, tiers);
      return { cargoStartX: -form.halfLength, cargoEndX: frontX };
    }
    default: {
      const unhandled: never = spec.superstructure;
      return unhandled;
    }
  }
}

/** Window bands along both sides of a passenger ship's cabin decks. */
function addCabinWindows(form: HullForm, parts: ShipParts, frontX: number, blockLength: number, deckY: number, tiers: number) {
  const tierHeight = readTierHeight(form);
  const halfWidth = readDeckHalfWidth(form, frontX - blockLength / 2) * 0.84;
  for (let tier = 0; tier < tiers; tier += 1) {
    const depthAlongShip = blockLength * (1 - tier * 0.07);
    const tierHalfWidth = halfWidth * (1 - tier * 0.022);
    const centerY = deckY + tier * tierHeight + tierHeight * 0.55;
    for (const side of [-1, 1]) addBox(parts.glass, [depthAlongShip * 0.94, 0.32 * tierHeight, 0.12], [frontX - depthAlongShip / 2, centerY, side * (tierHalfWidth + 0.06)]);
  }
}

/**
 * Builds one ship. `isDetailed` adds the plating seams as a bump map (the GPU tier); the software tier keeps the seams
 * in the colour map only. The viewer frees its GPU memory with the rest of the scene.
 */
export function buildShip(options: BuildShipOptions): ShipModel {
  const { kind, lengthMetres, tone, isDetailed } = options;
  const form = createHullForm(SHIP_SPECS[kind], lengthMetres);
  const toneColors = TONE_TOPSIDES[tone];
  const palette: HullPalette = {
    bottom: new THREE.Color(toneColors.bottom),
    bootTop: new THREE.Color(toneColors.bootTop),
    topside: new THREE.Color(toneColors.topside),
    water: new THREE.Color(SCENE_COLORS.water),
  };
  const plating = createHullPlatingTexture();
  // A little sheen so the hull's curves catch the light instead of reading as a flat silhouette.
  const hullMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18, map: plating });
  if (plating && isDetailed) {
    hullMaterial.bumpMap = plating;
    hullMaterial.bumpScale = 0.6;
  }
  const transomMaterial = new THREE.MeshStandardMaterial({ color: toneColors.topside, roughness: 0.42, metalness: 0.18 });
  const deckMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerDeck, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide });
  const structureMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerSuperstructure, roughness: 0.7, metalness: 0.02 });
  const equipmentMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerEquipment, roughness: 0.5, metalness: 0.35 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerGlass, roughness: 0.18, metalness: 0.55 });
  const funnelMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerFunnel, roughness: 0.6, metalness: 0.05 });
  const bandMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerFunnelBand, roughness: 0.6 });
  const lifeboatMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerLifeboat, roughness: 0.55 });

  const parts = createShipParts();
  const cargo = addSuperstructure(kind, form, parts);
  DECK_BUILDERS[kind](createDeckFrame(form, cargo.cargoStartX, cargo.cargoEndX), parts);
  addForecastleGear(form, parts);
  parts.equipment.push(...buildRailings(form, -form.halfLength + 2, form.halfLength - 2));
  const meshes = [
    new THREE.Mesh(buildHullShell(form, palette), hullMaterial),
    new THREE.Mesh(buildTransom(form), transomMaterial),
    new THREE.Mesh(buildDeck(form), deckMaterial),
    new THREE.Mesh(mergeParts(parts.equipment), equipmentMaterial),
    new THREE.Mesh(mergeParts(parts.structure), structureMaterial),
    new THREE.Mesh(mergeParts(parts.glass), glassMaterial),
    new THREE.Mesh(mergeParts(parts.funnel), funnelMaterial),
    new THREE.Mesh(mergeParts(parts.band), bandMaterial),
    new THREE.Mesh(mergeParts(parts.lifeboat), lifeboatMaterial),
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
  };
}
