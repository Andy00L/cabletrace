import { describe, expect, test } from "bun:test";
import { buildSeedLines, classifyOsmTags, clipLineToBox, lineLengthMetres, parseAcmaCableLines, parseOverpassLines, simplifyLine, type RawLine } from "@/lib/regions/line-network";

const BOX = { west: 10, east: 11, south: 55, north: 56 };

describe("classifyOsmTags", () => {
  test("keeps submarine power, telecom and pipeline lines and leaves out land, outfalls and chart-only lines of unknown kind", () => {
    expect(classifyOsmTags({ power: "cable", location: "underwater" })).toBe("power");
    expect(classifyOsmTags({ communication: "line", submarine: "yes" })).toBe("telecom");
    expect(classifyOsmTags({ telecom: "line", location: "underground;underwater" })).toBe("telecom");
    expect(classifyOsmTags({ man_made: "pipeline", location: "underwater", substance: "gas" })).toBe("pipeline");
    expect(classifyOsmTags({ man_made: "pipeline", location: "underwater", substance: "sewage" })).toBeNull();
    expect(classifyOsmTags({ power: "cable", location: "underground" })).toBeNull();
    expect(classifyOsmTags({ "seamark:type": "cable_submarine" })).toBeNull();
    expect(classifyOsmTags({ "seamark:type": "cable_submarine", "seamark:cable_submarine:category": "telephone" })).toBe("telecom");
    expect(classifyOsmTags({ "seamark:type": "pipeline_submarine", "seamark:pipeline_submarine:category": "supply" })).toBe("pipeline");
  });
});

describe("parsers", () => {
  test("read Overpass ways and ACMA features, skipping what is not a line", () => {
    const overpass = parseOverpassLines({
      elements: [
        { type: "way", id: 7, tags: { power: "cable", location: "underwater", name: "Link" }, geometry: [{ lat: 55.1, lon: 10.1 }, { lat: 55.2, lon: 10.2 }] },
        { type: "node", id: 8, tags: { power: "cable", location: "underwater" } },
        { type: "way", id: 9, tags: { power: "cable", location: "underwater" }, geometry: [{ lat: 55.1, lon: 10.1 }] },
      ],
    });
    expect(overpass).toEqual({ ok: true, value: [{ name: "Link", kind: "power", sourceId: "openstreetmap", sourceRef: "way/7", points: [[10.1, 55.1], [10.2, 55.2]] }] });
    expect(parseOverpassLines({ remark: "runtime error" }).ok).toBe(false);
    const acma = parseAcmaCableLines({
      features: [{ geometry: { type: "MultiLineString", coordinates: [[[115.7, -31.9], [115.0, -32.0]]] }, properties: { objectid: 9, cable: "Indigo West" } }],
    });
    expect(acma.ok && acma.value[0]).toEqual({ name: "Indigo West", kind: "telecom", sourceId: "acma-cable-locations-2021", sourceRef: "objectid/9", points: [[115.7, -31.9], [115.0, -32.0]] });
  });
});

describe("geometry", () => {
  test("clips a line leaving and re-entering the box into two parts", () => {
    const parts = clipLineToBox(
      [
        [10.5, 55.5],
        [11.5, 55.5],
        [11.5, 55.6],
        [10.5, 55.6],
      ],
      BOX,
    );
    expect(parts).toEqual([
      [
        [10.5, 55.5],
        [11, 55.5],
      ],
      [
        [11, 55.6],
        [10.5, 55.6],
      ],
    ]);
  });

  test("simplifies within the tolerance and keeps the ends", () => {
    const wiggly: [number, number][] = [
      [10, 55],
      [10.1, 55.0001],
      [10.2, 55],
      [10.3, 55.01],
    ];
    // 0.0001 degrees of latitude is 11 m: gone at 100 m; 0.01 degrees (1.1 km) stays.
    expect(simplifyLine(wiggly, 100)).toEqual([
      [10, 55],
      [10.2, 55],
      [10.3, 55.01],
    ]);
    expect(Math.round(lineLengthMetres([[10, 55], [10, 56]]))).toBe(111_195);
  });
});

describe("buildSeedLines", () => {
  const options = { box: BOX, marginDegrees: 0.1, simplifyMetres: 100, minimumLengthMetres: 5000 };

  test("joins the ways of one cable, keeps two cables of one landing apart, and drops short crossings", () => {
    const lines: RawLine[] = [
      { name: "Alpha", kind: "telecom", sourceId: "openstreetmap", sourceRef: "way/2", points: [[10.1, 55.1], [10.2, 55.1]] },
      { name: "Alpha", kind: "telecom", sourceId: "openstreetmap", sourceRef: "way/1", points: [[10.2, 55.1], [10.3, 55.1]] },
      // Beta starts at Alpha's landing node but is another cable.
      { name: "Beta", kind: "telecom", sourceId: "openstreetmap", sourceRef: "way/3", points: [[10.1, 55.1], [10.1, 55.3]] },
      // 1.1 km harbour crossing.
      { name: null, kind: "power", sourceId: "openstreetmap", sourceRef: "way/4", points: [[10.5, 55.5], [10.5, 55.51]] },
    ];
    const seeded = buildSeedLines(lines, options);
    expect(seeded.map((line) => [line.name, line.sourceRef, line.parts.length])).toEqual([
      ["Alpha", "way/1", 2],
      ["Beta", "way/3", 1],
    ]);
  });

  test("names unnamed lines after their way and keeps names unique", () => {
    const lines: RawLine[] = [
      { name: null, kind: "pipeline", sourceId: "openstreetmap", sourceRef: "way/5", points: [[10.1, 55.2], [10.4, 55.2]] },
      { name: "Gamma", kind: "power", sourceId: "openstreetmap", sourceRef: "way/6", points: [[10.1, 55.4], [10.4, 55.4]] },
      { name: "Gamma", kind: "power", sourceId: "openstreetmap", sourceRef: "way/7", points: [[10.1, 55.6], [10.4, 55.6]] },
    ];
    expect(buildSeedLines(lines, options).map((line) => line.name)).toEqual(["Unnamed submarine pipeline (way/5)", "Gamma (way/6)", "Gamma (way/7)"]);
  });
});
