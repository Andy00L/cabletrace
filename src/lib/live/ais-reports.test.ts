import { describe, expect, test } from "bun:test";
import {
  mergeShipStatics,
  parseAisstreamMessage,
  parseAisstreamTime,
  parseDigitrafficLocations,
  parseDigitrafficPositions,
  parseDigitrafficVessels,
  type ShipStatic,
} from "./ais-reports";

// Message shapes as wss://stream.aisstream.io/v0/stream sent them on 2026-10-17 (fields trimmed). Ships,
// names and positions are made up: no aisstream data is kept past 2 days, fixtures included.
const POSITION_REPORT = JSON.stringify({
  MetaData: { MMSI: 211000101, ShipName: "ELBE ONE              ", latitude: 49.79872, longitude: 9.16123, time_utc: "2026-10-17 08:25:58.734476107 +0000 UTC" },
  MessageType: "PositionReport",
  Message: {
    PositionReport: { MessageID: 1, UserID: 211000101, Valid: true, NavigationalStatus: 5, Sog: 0, Longitude: 9.161233333333333, Latitude: 49.79871666666667, Cog: 360, TrueHeading: 511 },
  },
});
const CLASS_B_POSITION = JSON.stringify({
  MetaData: { MMSI: 244000202, latitude: 53.10411, longitude: 6.04512, time_utc: "2026-10-17 08:25:58.729953556 +0000 UTC" },
  MessageType: "StandardClassBPositionReport",
  Message: { StandardClassBPositionReport: { Cog: 147.9, Latitude: 53.10411, Longitude: 6.0451166666666666, MessageID: 18, Sog: 2.5, TrueHeading: 511, UserID: 244000202, Valid: true } },
});
const EXTENDED_CLASS_B = JSON.stringify({
  MetaData: { MMSI: 525000303, latitude: -6.38117, longitude: 111.52033, time_utc: "2026-10-17 08:26:03.337103527 +0000 UTC" },
  MessageType: "ExtendedClassBPositionReport",
  Message: {
    ExtendedClassBPositionReport: { Cog: 301.9, Dimension: { A: 0, B: 0, C: 0, D: 0 }, Latitude: -6.381166666666667, Longitude: 111.52033333333333, Name: "KM SAMPLE TIGA      ", Sog: 3, TrueHeading: 511, Type: 30, UserID: 525000303, Valid: true },
  },
});
const SHIP_STATIC = JSON.stringify({
  MetaData: { MMSI: 244000404, time_utc: "2026-10-17 08:25:58.775023528 +0000 UTC" },
  MessageType: "ShipStaticData",
  Message: {
    ShipStaticData: { CallSign: "PA0000", Destination: "ROTTERDAM", Dimension: { A: 5, B: 4, C: 2, D: 1 }, ImoNumber: 0, MaximumStaticDraught: 1, Name: "TEST BARGE 4", Type: 49, UserID: 244000404, Valid: true },
  },
});
const STATIC_PART_A = JSON.stringify({
  MetaData: { MMSI: 368000505, time_utc: "2026-10-17 08:25:58.851371898 +0000 UTC" },
  MessageType: "StaticDataReport",
  Message: {
    StaticDataReport: {
      MessageID: 24,
      PartNumber: false,
      ReportA: { Name: "SAMPLE B", Valid: true },
      ReportB: { CallSign: "", Dimension: { A: 0, B: 0, C: 0, D: 0 }, ShipType: 0, Valid: false },
      UserID: 368000505,
      Valid: true,
    },
  },
});
const STATIC_PART_B = JSON.stringify({
  MetaData: { MMSI: 368000505, time_utc: "2026-10-17 08:26:10.000000000 +0000 UTC" },
  MessageType: "StaticDataReport",
  Message: {
    StaticDataReport: {
      MessageID: 24,
      PartNumber: true,
      ReportA: { Name: "", Valid: false },
      ReportB: { CallSign: "WDK0000", Dimension: { A: 8, B: 4, C: 2, D: 2 }, ShipType: 37, Valid: true },
      UserID: 368000505,
      Valid: true,
    },
  },
});

describe("parseAisstreamTime", () => {
  test("reads aisstream's Go-style timestamp to the millisecond", () => {
    expect(parseAisstreamTime("2026-10-17 08:25:58.734476107 +0000 UTC")).toBe(Date.UTC(2026, 9, 17, 8, 25, 58, 734));
    expect(parseAisstreamTime("2026-10-17 08:25:58 +0000 UTC")).toBe(Date.UTC(2026, 9, 17, 8, 25, 58));
    expect(parseAisstreamTime("17/10/2026")).toBeNull();
    expect(parseAisstreamTime(42)).toBeNull();
  });
});

describe("parseAisstreamMessage", () => {
  test("turns class A and class B positions into records, with AIS not-available codes as null", () => {
    const classA = parseAisstreamMessage(POSITION_REPORT);
    expect(classA).toEqual({
      kind: "position",
      report: {
        mmsi: 211000101,
        longitude: 9.161233333333333,
        latitude: 49.79871666666667,
        speedKnots: 0,
        courseDegrees: null,
        headingDegrees: null,
        shipClass: "unknown",
        reportedAtMs: Date.UTC(2026, 9, 17, 8, 25, 58, 734),
        source: "aisstream",
      },
      status: { navigationStatus: 5, turnRate: null },
      staticData: null,
    });
    const classB = parseAisstreamMessage(CLASS_B_POSITION);
    expect(classB.kind === "position" && classB.report).toMatchObject({ mmsi: 244000202, speedKnots: 2.5, courseDegrees: 147.9, headingDegrees: null });
    expect(classB.kind === "position" && classB.status).toEqual({ navigationStatus: null, turnRate: null });
  });

  test("keeps the rate of turn code and drops its not-available value", () => {
    const turning = parseAisstreamMessage(POSITION_REPORT.replace('"TrueHeading":511', '"TrueHeading":511,"RateOfTurn":-12'));
    expect(turning.kind === "position" && turning.status).toEqual({ navigationStatus: 5, turnRate: -12 });
    const unknownTurn = parseAisstreamMessage(POSITION_REPORT.replace('"NavigationalStatus":5', '"NavigationalStatus":15,"RateOfTurn":-128'));
    expect(unknownTurn.kind === "position" && unknownTurn.status).toEqual({ navigationStatus: 15, turnRate: null });
  });

  test("keeps the name and type that message 19 carries next to its position", () => {
    const extended = parseAisstreamMessage(EXTENDED_CLASS_B);
    expect(extended.kind).toBe("position");
    if (extended.kind !== "position") return;
    expect(extended.staticData).toMatchObject({ mmsi: 525000303, name: "KM SAMPLE TIGA", shipType: 30, lengthMetres: null, beamMetres: null });
  });

  test("reads class A static data, treating zero IMO as absent", () => {
    expect(parseAisstreamMessage(SHIP_STATIC)).toEqual({
      kind: "static",
      staticData: {
        mmsi: 244000404,
        name: "TEST BARGE 4",
        callSign: "PA0000",
        imo: null,
        shipType: 49,
        lengthMetres: 9,
        beamMetres: 3,
        draughtMetres: 1,
        destination: "ROTTERDAM",
        source: "aisstream",
      },
    });
  });

  test("leaves sizes the AIS dimension fields cannot carry unknown, so one bad message cannot fail an upsert", () => {
    const oversized = parseAisstreamMessage(SHIP_STATIC.replace('"Dimension":{"A":5,"B":4,"C":2,"D":1}', '"Dimension":{"A":40000,"B":4,"C":200,"D":1}'));
    expect(oversized.kind === "static" && oversized.staticData).toMatchObject({ lengthMetres: null, beamMetres: null });
    const largest = parseAisstreamMessage(SHIP_STATIC.replace('"Dimension":{"A":5,"B":4,"C":2,"D":1}', '"Dimension":{"A":511,"B":511,"C":63,"D":63}'));
    expect(largest.kind === "static" && largest.staticData).toMatchObject({ lengthMetres: 1022, beamMetres: 126 });
    const negative = parseAisstreamMessage(SHIP_STATIC.replace('"Dimension":{"A":5,"B":4,"C":2,"D":1}', '"Dimension":{"A":-5,"B":40,"C":2,"D":1}'));
    expect(negative.kind === "static" && negative.staticData).toMatchObject({ lengthMetres: null, beamMetres: 3 });
  });

  test("reads both parts of class B static data", () => {
    const partA = parseAisstreamMessage(STATIC_PART_A);
    const partB = parseAisstreamMessage(STATIC_PART_B);
    expect(partA.kind === "static" && partA.staticData).toMatchObject({ name: "SAMPLE B", shipType: null, callSign: null });
    expect(partB.kind === "static" && partB.staticData).toMatchObject({ name: null, shipType: 37, callSign: "WDK0000", lengthMetres: 12, beamMetres: 4 });
  });

  test("separates server errors from noise", () => {
    expect(parseAisstreamMessage('{"error":"Api Key Is Not Valid"}')).toEqual({ kind: "server-error", reason: "Api Key Is Not Valid" });
    expect(parseAisstreamMessage('{"Message":{"CompressionEnabled":false},"MessageType":"SubscriptionConfirmation"}')).toEqual({
      kind: "ignored",
      reason: "subscription confirmation",
    });
    expect(parseAisstreamMessage("not json")).toEqual({ kind: "ignored", reason: "not JSON" });
    const offGlobe = POSITION_REPORT.replace('"Latitude":49.79871666666667', '"Latitude":91');
    expect(parseAisstreamMessage(offGlobe)).toEqual({ kind: "ignored", reason: "no valid position" });
    const badMmsi = POSITION_REPORT.replaceAll("211000101", "0");
    expect(parseAisstreamMessage(badMmsi)).toEqual({ kind: "ignored", reason: "no MMSI" });
  });
});

describe("Digitraffic parsers", () => {
  test("keeps recent locations only and maps the not-available codes", () => {
    const sinceMs = 1_792_224_000_000;
    const parsed = parseDigitrafficLocations(
      {
        type: "FeatureCollection",
        features: [
          { geometry: { coordinates: [28.310127, 59.677663] }, properties: { mmsi: 273358970, sog: 0.1, cog: 360.0, heading: 511, timestampExternal: sinceMs + 1 } },
          { geometry: { coordinates: [24.9, 60.1] }, properties: { mmsi: 230000001, sog: 102.3, cog: 45, heading: 44, timestampExternal: sinceMs - 1 } },
          { geometry: { coordinates: [200, 60.1] }, properties: { mmsi: 230000002, timestampExternal: sinceMs + 1 } },
          "garbage",
        ],
      },
      sinceMs,
    );
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          mmsi: 273358970,
          longitude: 28.310127,
          latitude: 59.677663,
          speedKnots: 0.1,
          courseDegrees: null,
          headingDegrees: null,
          shipClass: "unknown",
          reportedAtMs: sinceMs + 1,
          source: "digitraffic",
        },
      ],
    });
    expect(parseDigitrafficLocations({ features: "none" }, 0)).toEqual({ ok: false, reason: "Digitraffic locations: no features array" });
  });

  test("keeps navigational status and rate of turn for the recorder", () => {
    const parsed = parseDigitrafficPositions(
      {
        features: [
          { geometry: { coordinates: [25.1, 60.0] }, properties: { mmsi: 230000003, sog: 6.4, cog: 88, heading: 90, navStat: 0, rot: 4, timestampExternal: 10 } },
          { geometry: { coordinates: [25.2, 60.0] }, properties: { mmsi: 230000004, sog: 0, cog: 0, heading: 1, navStat: 99, rot: -128, timestampExternal: 10 } },
        ],
      },
      0,
    );
    expect(parsed.ok && parsed.value.map((position) => position.status)).toEqual([
      { navigationStatus: 0, turnRate: 4 },
      { navigationStatus: null, turnRate: null },
    ]);
  });

  test("reads vessel metadata with sizes from the reference points and draught in tenths", () => {
    const parsed = parseDigitrafficVessels([
      {
        callSign: "5LCJ3",
        destination: "FORORDER",
        draught: 75,
        imo: 9381196,
        mmsi: 636021117,
        name: "FUXING V",
        referencePointA: 200,
        referencePointB: 34,
        referencePointC: 17,
        referencePointD: 26,
        shipType: 70,
        timestamp: 1792224433602,
      },
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          updatedAtMs: 1792224433602,
          staticData: {
            mmsi: 636021117,
            name: "FUXING V",
            callSign: "5LCJ3",
            imo: 9381196,
            shipType: 70,
            lengthMetres: 234,
            beamMetres: 43,
            draughtMetres: 7.5,
            destination: "FORORDER",
            source: "digitraffic",
          },
        },
      ],
    });
    expect(parseDigitrafficVessels({}).ok).toBe(false);
  });
});

describe("mergeShipStatics", () => {
  test("fills each ship's fields from the messages that carried them", () => {
    const base: ShipStatic = {
      mmsi: 368000505,
      name: null,
      callSign: null,
      imo: null,
      shipType: null,
      lengthMetres: null,
      beamMetres: null,
      draughtMetres: null,
      destination: null,
      source: "aisstream",
    };
    const merged = mergeShipStatics([
      { ...base, name: "SAMPLE B" },
      { ...base, mmsi: 1, name: "OTHER" },
      { ...base, shipType: 37, callSign: "WDK0000" },
      { ...base, callSign: "WDK9999" },
    ]);
    expect(merged).toEqual([
      { ...base, name: "SAMPLE B", shipType: 37, callSign: "WDK9999" },
      { ...base, mmsi: 1, name: "OTHER" },
    ]);
  });
});
