import { describe, expect, test } from "bun:test";
import { catenaryLaybackMetres, computeLayback, estimateAnchorModel, lookupEquipmentRow } from "./anchor-model";

// Yi Peng 3 as AIS gives it (DMA archive row of 18 Nov 2024 07:27:56): 224 x 32 m, draught 14.5 m, antenna 189 m.
const YI_PENG_3 = { lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 };

describe("anchor model", () => {
  test("UR A1 Table 1 rows are looked up by their lower bound and clamped at both ends", () => {
    expect(lookupEquipmentRow(3163)).toEqual({ equipmentNumber: 3163, anchorMassKg: 9300, chainPerAnchorMetres: 330, chainDiameterMm: 84 });
    expect(lookupEquipmentRow(100).anchorMassKg).toBe(660);
    expect(lookupEquipmentRow(20_000).anchorMassKg).toBe(46000);
  });

  test("Yi Peng 3's size gives 330 m of chain per anchor, the length Lloyd's List reports was deployed", () => {
    const model = estimateAnchorModel(YI_PENG_3);
    expect(model.chainPerAnchorMetres).toBe(330);
    expect(model.antennaFromBowMetres).toBe(189);
    expect(model.assumptions.length).toBeGreaterThan(3);
  });

  test("the catenary layback lies between the slack and taut bounds", () => {
    const model = estimateAnchorModel(YI_PENG_3);
    const heightMetres = 45 + model.hawseAboveWaterMetres;
    const layback = catenaryLaybackMetres({
      paidOutMetres: 330,
      heightMetres,
      chainWeightNewtonsPerMetre: model.chainWeightNewtonsPerMetre,
      anchorWeightNewtons: model.anchorWeightNewtons,
    });
    expect(layback).not.toBeNull();
    expect(layback ?? 0).toBeGreaterThan(330 - heightMetres);
    expect(layback ?? 0).toBeLessThan(Math.sqrt(330 ** 2 - heightMetres ** 2));
  });

  test("a chain shorter than the water is deep never reaches the seabed", () => {
    expect(catenaryLaybackMetres({ paidOutMetres: 50, heightMetres: 60, chainWeightNewtonsPerMetre: 1000, anchorWeightNewtons: 80_000 })).toBeNull();
  });

  test("unknown depth widens the layback band around the known-depth one", () => {
    const model = estimateAnchorModel(YI_PENG_3);
    const known = computeLayback(model, -45);
    const unknown = computeLayback(model, null);
    expect(known?.depthMetres).toBe(45);
    expect(unknown?.depthMetres).toBeNull();
    expect((unknown?.maxMetres ?? 0) - (unknown?.minMetres ?? 0)).toBeGreaterThan((known?.maxMetres ?? 0) - (known?.minMetres ?? 0));
  });

  test("an unknown ship size still yields a model with a wider chain band", () => {
    const model = estimateAnchorModel(null);
    expect(model.chainPerAnchorMinMetres).toBeLessThan(model.chainPerAnchorMaxMetres);
  });
});
