import type { AnchorModel, ShipSize } from "@/lib/detection/detection-types";

// The anchor trails the hawse pipe by the chain's layback. This module estimates the ship's anchoring equipment
// from its size (IACS UR A1 equipment number), then shapes the paid-out chain as a catenary for the local depth.

/**
 * IACS Unified Requirement A1 "Anchoring Equipment", Rev.7 2020 / Corr.1 2021, Table 1 (stockless bower anchors,
 * stud link chain cable): [equipment number lower bound, mass per anchor kg, total chain length m for both bowers,
 * minimum chain diameter mm in grade 2, or grade 3 where Table 1 gives no grade 2 value].
 * Read from https://ww2.eagle.org/content/dam/eagle/regulatory-news/2022/IACS-UR-A1.pdf on 17 Oct 2026.
 */
const UR_A1_TABLE_1: readonly (readonly [number, number, number, number])[] = [
  [205, 660, 302.5, 22], [240, 780, 330, 24], [280, 900, 357.5, 26], [320, 1020, 357.5, 28], [360, 1140, 385, 30],
  [400, 1290, 385, 32], [450, 1440, 412.5, 34], [500, 1590, 412.5, 34], [550, 1740, 440, 36], [600, 1920, 440, 38],
  [660, 2100, 440, 40], [720, 2280, 467.5, 42], [780, 2460, 467.5, 44], [840, 2640, 467.5, 46], [910, 2850, 495, 48],
  [980, 3060, 495, 50], [1060, 3300, 495, 50], [1140, 3540, 522.5, 52], [1220, 3780, 522.5, 54], [1300, 4050, 522.5, 56],
  [1390, 4320, 550, 58], [1480, 4590, 550, 60], [1570, 4890, 550, 62], [1670, 5250, 577.5, 64], [1790, 5610, 577.5, 66],
  [1930, 6000, 577.5, 68], [2080, 6450, 605, 70], [2230, 6900, 605, 73], [2380, 7350, 605, 76], [2530, 7800, 632.5, 78],
  [2700, 8300, 632.5, 81], [2870, 8700, 632.5, 84], [3040, 9300, 660, 84], [3210, 9900, 660, 87], [3400, 10500, 660, 90],
  [3600, 11100, 687.5, 92], [3800, 11700, 687.5, 95], [4000, 12300, 687.5, 97], [4200, 12900, 715, 100], [4400, 13500, 715, 102],
  [4600, 14100, 715, 105], [4800, 14700, 742.5, 107], [5000, 15400, 742.5, 111], [5200, 16100, 742.5, 111], [5500, 16900, 742.5, 114],
  [5800, 17800, 742.5, 117], [6100, 18800, 742.5, 120], [6500, 20000, 770, 124], [6900, 21500, 770, 127], [7400, 23000, 770, 132],
  [7900, 24500, 770, 137], [8400, 26000, 770, 142], [8900, 27500, 770, 147], [9400, 29000, 770, 152], [10000, 31000, 770, 137],
  [10700, 33000, 770, 142], [11500, 35500, 770, 147], [12400, 38500, 770, 152], [13400, 42000, 770, 157], [14600, 46000, 770, 162],
];

// UR A1, A1.2.2: the total length in Table 1 "is to be divided in approximately equal parts between the two bower anchors".
const BOWER_ANCHOR_COUNT = 2;
// UR A1, A1.1.4: the equipment assumes "a minimum scope of chain cable of 6" (paid-out length over water depth).
// Used as the short end of the paid-out band: a crew anchoring on purpose pays out at least this much.
const UR_A1_MIN_SCOPE = 6;
// Stud link chain mass in air is 0.0219 d^2 kg per metre, d in mm (DNV-OS-E302, as given in the SINTEF SIMA RIFLEX
// manual, https://sima.sintef.no/docs/latest/riflex/sima/context/ChainCrossSection.html, read 17 Oct 2026).
const STUD_LINK_MASS_COEFFICIENT = 0.0219;
// Steel 7.85 t/m3 in sea water 1.025 t/m3: a submerged body weighs 1 - 1.025 / 7.85 = 0.869 of its weight in air.
const SUBMERGED_WEIGHT_FRACTION = 1 - 1.025 / 7.85;
const STANDARD_GRAVITY = 9.80665;
// Sliding friction of chain on soft mud, sand and clay: 0.70 (Iranian Classification Society rules for floating
// production units, Table 6.4: chain 1.00 starting, 0.70 sliding). Also used for the anchor dragged on its side;
// the layback band below does not depend on it.
const CHAIN_SLIDING_FRICTION = 0.7;
// Sea water density in t/m3, for displacement from the underwater volume.
const SEA_WATER_DENSITY = 1.025;

// Size assumptions where AIS is silent. Measured on the two case ships (Yi Peng 3: 224 x 32 m, draught 14.5 m,
// antenna 189 m from the bow, Danish Maritime Authority archive row of 18 Nov 2024 07:27:56; Eagle S: 228.6 x 32 m).
const BEAM_TO_LENGTH = 0.14;
const DRAUGHT_TO_LENGTH = 0.06;
const ANTENNA_FROM_BOW_TO_LENGTH = 0.84;
// Unknown length: the model spans ships from 120 m to 300 m (the drag cases so far are 224 and 228.6 m) around 200 m.
const UNKNOWN_LENGTH_NOMINAL_METRES = 200;
const UNKNOWN_LENGTH_RANGE_METRES: readonly [number, number] = [120, 300];

// Naval architecture assumptions for the equipment number, stated in every model's `assumptions`:
// typical block coefficients (tankers 0.80 to 0.85, bulk and general cargo 0.75 to 0.80, other ships about 0.70),
// length between perpendiculars 0.97 of length overall, freeboard 0.4 of the draught, 12 m of deckhouse tiers
// over 12% of the length on ships of 100 m or more (6 m below), and the hawse pipe 3 m above the freeboard deck line.
const TANKER_BLOCK_COEFFICIENT = 0.82;
const CARGO_BLOCK_COEFFICIENT = 0.78;
const OTHER_BLOCK_COEFFICIENT = 0.7;
const PERPENDICULARS_TO_OVERALL = 0.97;
const FREEBOARD_TO_DRAUGHT = 0.4;
const LARGE_SHIP_DECKHOUSE_METRES = 12;
const SMALL_SHIP_DECKHOUSE_METRES = 6;
const DECKHOUSE_LENGTH_FRACTION = 0.12;
const HAWSE_ABOVE_FREEBOARD_METRES = 3;

// Water depth when the grid does not cover the point: the Gulf of Finland mean depth of 37 m (Alenius, Myrberg and
// Nekrasov 1998, "The physical oceanography of the Gulf of Finland: a review", Boreal Environment Research 3: 97-125),
// with the band widened to 20 to 100 m, the depths of its shipping lanes.
const UNKNOWN_DEPTH_NOMINAL_METRES = 37;
const UNKNOWN_DEPTH_RANGE_METRES: readonly [number, number] = [20, 100];

type EquipmentRow = { equipmentNumber: number; anchorMassKg: number; chainPerAnchorMetres: number; chainDiameterMm: number };

/** The UR A1 Table 1 row for an equipment number; below the table it is the first row, above it the last. */
export function lookupEquipmentRow(equipmentNumber: number): EquipmentRow {
  let chosen = UR_A1_TABLE_1[0] ?? [205, 660, 302.5, 22];
  for (const row of UR_A1_TABLE_1) {
    if (row[0] <= equipmentNumber) chosen = row;
  }
  const [, anchorMassKg, totalChainMetres, chainDiameterMm] = chosen;
  return { equipmentNumber, anchorMassKg, chainPerAnchorMetres: totalChainMetres / BOWER_ANCHOR_COUNT, chainDiameterMm };
}

function blockCoefficientFor(shipType: number | null): number {
  if (shipType !== null && shipType >= 80 && shipType <= 89) return TANKER_BLOCK_COEFFICIENT;
  if (shipType !== null && shipType >= 70 && shipType <= 79) return CARGO_BLOCK_COEFFICIENT;
  return OTHER_BLOCK_COEFFICIENT;
}

type HullEstimate = { lengthMetres: number; equipmentNumber: number; freeboardMetres: number };

/** EN = displacement^(2/3) + 2 h B + A / 10 (UR A1, A1.2.1; the funnel term is left out). */
function estimateHull(lengthMetres: number, ship: ShipSize | null): HullEstimate {
  const beamMetres = ship?.beamMetres ?? lengthMetres * BEAM_TO_LENGTH;
  const draughtMetres = Math.max(ship?.draughtMetres ?? 0, lengthMetres * DRAUGHT_TO_LENGTH);
  const perpendicularsMetres = lengthMetres * PERPENDICULARS_TO_OVERALL;
  const displacementTonnes = blockCoefficientFor(ship?.shipType ?? null) * perpendicularsMetres * beamMetres * draughtMetres * SEA_WATER_DENSITY;
  const freeboardMetres = FREEBOARD_TO_DRAUGHT * draughtMetres;
  const deckhouseMetres = lengthMetres >= 100 ? LARGE_SHIP_DECKHOUSE_METRES : SMALL_SHIP_DECKHOUSE_METRES;
  const effectiveHeightMetres = freeboardMetres + deckhouseMetres;
  const sideAreaSquareMetres = perpendicularsMetres * freeboardMetres + DECKHOUSE_LENGTH_FRACTION * lengthMetres * deckhouseMetres;
  const equipmentNumber = displacementTonnes ** (2 / 3) + 2 * effectiveHeightMetres * beamMetres + sideAreaSquareMetres / 10;
  return { lengthMetres, equipmentNumber, freeboardMetres };
}

export type ChainState = AnchorModel & {
  /** Submerged chain weight in newtons per metre. */
  chainWeightNewtonsPerMetre: number;
  /** Submerged anchor weight in newtons. */
  anchorWeightNewtons: number;
  hawseAboveWaterMetres: number;
  nominalPaidOutMetres: number;
};

/** Estimates the anchoring equipment of a ship from its AIS size, with every assumption written down. */
export function estimateAnchorModel(ship: ShipSize | null): ChainState {
  const knownLength = ship?.lengthMetres !== null && ship?.lengthMetres !== undefined && ship.lengthMetres > 0 ? ship.lengthMetres : null;
  const nominalHull = estimateHull(knownLength ?? UNKNOWN_LENGTH_NOMINAL_METRES, ship);
  const nominalRow = lookupEquipmentRow(nominalHull.equipmentNumber);
  const [shortestLength, longestLength] = knownLength === null ? UNKNOWN_LENGTH_RANGE_METRES : [knownLength, knownLength];
  const shortestRow = lookupEquipmentRow(estimateHull(shortestLength, ship).equipmentNumber);
  const longestRow = lookupEquipmentRow(estimateHull(longestLength, ship).equipmentNumber);
  const lengthForAntenna = knownLength ?? UNKNOWN_LENGTH_NOMINAL_METRES;
  const antennaFromBowMetres = ship?.antennaFromBowMetres ?? lengthForAntenna * ANTENNA_FROM_BOW_TO_LENGTH;
  const chainMassKgPerMetre = STUD_LINK_MASS_COEFFICIENT * nominalRow.chainDiameterMm ** 2;
  const assumptions = [
    knownLength === null
      ? `Length unknown: anchoring equipment for a ${UNKNOWN_LENGTH_NOMINAL_METRES} m ship, with the band spanning ${UNKNOWN_LENGTH_RANGE_METRES[0]} to ${UNKNOWN_LENGTH_RANGE_METRES[1]} m ships.`
      : `Length ${knownLength} m from AIS.`,
    ship?.beamMetres ? `Beam ${ship.beamMetres} m from AIS.` : `Beam assumed ${BEAM_TO_LENGTH} of the length.`,
    `Equipment number ${Math.round(nominalHull.equipmentNumber)} from IACS UR A1 A1.2.1 with typical hull proportions; Table 1 gives ${nominalRow.anchorMassKg} kg anchors and ${nominalRow.chainPerAnchorMetres} m of ${nominalRow.chainDiameterMm} mm chain per anchor.`,
    `Paid-out chain between ${UR_A1_MIN_SCOPE} times the water depth and all the chain of one anchor.`,
    ship?.antennaFromBowMetres ? `AIS antenna ${ship.antennaFromBowMetres} m from the bow (AIS dimension A).` : `AIS antenna assumed ${ANTENNA_FROM_BOW_TO_LENGTH} of the length from the bow.`,
  ];
  return {
    equipmentNumber: Math.round(nominalHull.equipmentNumber),
    anchorMassKg: nominalRow.anchorMassKg,
    chainDiameterMm: nominalRow.chainDiameterMm,
    chainPerAnchorMetres: nominalRow.chainPerAnchorMetres,
    chainPerAnchorMinMetres: Math.min(shortestRow.chainPerAnchorMetres, nominalRow.chainPerAnchorMetres),
    chainPerAnchorMaxMetres: Math.max(longestRow.chainPerAnchorMetres, nominalRow.chainPerAnchorMetres),
    antennaFromBowMetres,
    assumptions,
    chainWeightNewtonsPerMetre: chainMassKgPerMetre * STANDARD_GRAVITY * SUBMERGED_WEIGHT_FRACTION,
    anchorWeightNewtons: nominalRow.anchorMassKg * STANDARD_GRAVITY * SUBMERGED_WEIGHT_FRACTION,
    hawseAboveWaterMetres: nominalHull.freeboardMetres + HAWSE_ABOVE_FREEBOARD_METRES,
    nominalPaidOutMetres: nominalRow.chainPerAnchorMetres,
  };
}

/**
 * Horizontal distance from hawse pipe to anchor for a chain hanging as a catenary from height `heightMetres` above
 * the seabed, the rest lying on the seabed behind it. Horizontal tension balances the sliding friction of the anchor
 * and of the grounded chain. Returns null when the chain is too short to reach the seabed.
 */
export function catenaryLaybackMetres(input: { paidOutMetres: number; heightMetres: number; chainWeightNewtonsPerMetre: number; anchorWeightNewtons: number }): number | null {
  const { paidOutMetres, heightMetres, chainWeightNewtonsPerMetre, anchorWeightNewtons } = input;
  if (!(paidOutMetres > heightMetres) || !(heightMetres > 0) || !(chainWeightNewtonsPerMetre > 0)) return null;
  const suspendedFor = (tensionNewtons: number) => Math.sqrt(heightMetres ** 2 + (2 * heightMetres * tensionNewtons) / chainWeightNewtonsPerMetre);
  const anchorFriction = CHAIN_SLIDING_FRICTION * anchorWeightNewtons;
  // Tension balance: T = anchor friction + friction of the grounded chain (paid out minus suspended). The right side
  // falls as T grows, so bisection finds the single crossing.
  const imbalance = (tensionNewtons: number) =>
    anchorFriction + CHAIN_SLIDING_FRICTION * chainWeightNewtonsPerMetre * Math.max(0, paidOutMetres - suspendedFor(tensionNewtons)) - tensionNewtons;
  let lowTension = 0;
  let highTension = anchorFriction + CHAIN_SLIDING_FRICTION * chainWeightNewtonsPerMetre * paidOutMetres + 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (lowTension + highTension) / 2;
    if (imbalance(middle) > 0) lowTension = middle;
    else highTension = middle;
  }
  const tensionNewtons = (lowTension + highTension) / 2;
  const suspendedMetres = suspendedFor(tensionNewtons);
  if (suspendedMetres >= paidOutMetres) {
    // The whole chain hangs: its catenary parameter follows from length and height alone.
    const parameter = (paidOutMetres ** 2 - heightMetres ** 2) / (2 * heightMetres);
    return parameter * Math.asinh(paidOutMetres / parameter);
  }
  const parameter = tensionNewtons / chainWeightNewtonsPerMetre;
  return paidOutMetres - suspendedMetres + parameter * Math.asinh(suspendedMetres / parameter);
}

export type Layback = { nominalMetres: number; minMetres: number; maxMetres: number; depthMetres: number | null };

/**
 * Layback for the local depth (negative metres below sea level, or null when unknown). The band is geometric and
 * holds whatever the tension: a chain of length L hung from height H lies between L - H (slack) and
 * sqrt(L^2 - H^2) (taut) behind the hawse, taken over the paid-out band and the depth band.
 */
export function computeLayback(model: ChainState, seabedElevationMetres: number | null): Layback | null {
  const depthMetres = seabedElevationMetres !== null && seabedElevationMetres < 0 ? -seabedElevationMetres : null;
  const [shallowest, deepest] = depthMetres === null ? UNKNOWN_DEPTH_RANGE_METRES : [depthMetres, depthMetres];
  const nominalDepth = depthMetres ?? UNKNOWN_DEPTH_NOMINAL_METRES;
  const toHeight = (depth: number) => depth + model.hawseAboveWaterMetres;
  const nominalMetres = catenaryLaybackMetres({
    paidOutMetres: model.nominalPaidOutMetres,
    heightMetres: toHeight(nominalDepth),
    chainWeightNewtonsPerMetre: model.chainWeightNewtonsPerMetre,
    anchorWeightNewtons: model.anchorWeightNewtons,
  });
  if (nominalMetres === null) return null;
  // Shortest layback: the least chain the band allows (scope 6 or one anchor's chain on the smallest ship) hanging slack.
  const slackLaybackAt = (depth: number) => Math.max(0, Math.min(model.chainPerAnchorMinMetres, UR_A1_MIN_SCOPE * depth) - toHeight(depth));
  const minMetres = Math.min(slackLaybackAt(shallowest), slackLaybackAt(deepest));
  const maxMetres = Math.sqrt(Math.max(0, model.chainPerAnchorMaxMetres ** 2 - toHeight(shallowest) ** 2));
  return { nominalMetres, minMetres: Math.min(minMetres, nominalMetres), maxMetres: Math.max(maxMetres, nominalMetres), depthMetres };
}
