// Orchestration tests for collectShipFrame with in-memory ports (no network, no Supabase).
// Run: deno test --no-lock --config supabase/functions/collect-ship-frames/deno.json supabase/functions/collect-ship-frames/collect.test.ts
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import type { Result } from "../../../src/lib/result.ts";
import type { ShipStatic } from "../../../src/lib/live/ais-reports.ts";
import { gunzipBytes, gzipBytes } from "../../../src/lib/live/frame-compression.ts";
import { FRAME_INDEX_PATH, frameObjectPath, parseFrameIndex, parseFrameObjectName, SLOT_MS, slotStartMs } from "../../../src/lib/live/frame-layout.ts";
import { decodeShipFrame, encodeShipFrame, readShipRecords, type ShipRecord } from "../../../src/lib/live/snapshot-codec.ts";
import type { CrossSourceSample } from "../../../src/lib/live/cross-source.ts";
import { collectShipFrame, type CollectorPorts } from "./collect.ts";

const SLOT_START_MS = Date.UTC(2026, 9, 17, 14, 30);
const RUN_START_MS = SLOT_START_MS + 2 * 60_000;

function formatAisstreamTime(timeMs: number): string {
  return `${new Date(timeMs).toISOString().replace("T", " ").replace("Z", "")}000 +0000 UTC`;
}

function positionMessage(mmsi: number, longitude: number, latitude: number, timeMs: number): string {
  return JSON.stringify({
    Message: { PositionReport: { Cog: 12.5, Latitude: latitude, Longitude: longitude, Sog: 8.2, TrueHeading: 13, UserID: mmsi, Valid: true } },
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, latitude, longitude, time_utc: formatAisstreamTime(timeMs) },
  });
}

function staticMessage(mmsi: number, shipType: number): string {
  return JSON.stringify({
    Message: { ShipStaticData: { Name: "NORDIC STAR@@@", Type: shipType, Dimension: { A: 100, B: 20, C: 10, D: 8 }, UserID: mmsi, Valid: true } },
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, time_utc: formatAisstreamTime(RUN_START_MS) },
  });
}

type MemoryStore = {
  objects: Map<string, { bytes: Uint8Array; cacheSeconds: number }>;
  upserted: ShipStatic[];
  listings: number;
  crossSource?: CrossSourceSample[];
};

function createPorts(store: MemoryStore, messages: string[], digitrafficFeatures: unknown[], runStartMs = RUN_START_MS): CollectorPorts {
  let clockMs = runStartMs;
  return {
    frames: {
      listFrames: () => {
        store.listings += 1;
        const frames = [...store.objects.entries()]
          .map(([path, object]) => ({ slot: parseFrameObjectName(path.replace(/^frames\//u, "")), bytes: object.bytes.byteLength }))
          .flatMap((entry) => (entry.slot.ok ? [{ slotStartMs: entry.slot.value, bytes: entry.bytes }] : []));
        return Promise.resolve({ ok: true, value: frames });
      },
      readObject: (path): Promise<Result<Uint8Array | null>> => Promise.resolve({ ok: true, value: store.objects.get(path)?.bytes ?? null }),
      writeObject: (path, bytes, _contentType, cacheSeconds) => {
        store.objects.set(path, { bytes, cacheSeconds });
        return Promise.resolve({ ok: true, value: null });
      },
      deleteObjects: (paths) => {
        paths.forEach((path) => store.objects.delete(path));
        return Promise.resolve({ ok: true, value: null });
      },
    },
    statics: {
      upsertStatics: (statics) => {
        store.upserted.push(...statics);
        return Promise.resolve({ ok: true, value: statics.length });
      },
      readShipTypes: (mmsis) => Promise.resolve({ ok: true, value: new Map(mmsis.filter((mmsi) => mmsi === 555_000_001).map((mmsi) => [mmsi, 80])) }),
    },
    listen: ({ onMessageText, listenMs }) => {
      messages.forEach(onMessageText);
      clockMs = runStartMs + listenMs;
      return Promise.resolve({ ok: true, value: { openedAfterMs: 1, listenedMs: 40_000, messageCount: messages.length, messageBytes: 0, extensions: "", closedEarly: null, connections: 1 } });
    },
    fetchDigitrafficLocations: () => Promise.resolve({ ok: true, value: { type: "FeatureCollection", features: digitrafficFeatures } }),
    fetchDigitrafficVessels: () =>
      Promise.resolve({
        ok: true,
        value: [{ mmsi: 230_000_001, name: "FINNMAID", shipType: 69, referencePointA: 150, referencePointB: 68, draught: 64, timestamp: RUN_START_MS }],
      }),
    storeCrossSourceSamples: (samples) => {
      store.crossSource = [...(store.crossSource ?? []), ...samples];
      return Promise.resolve({ ok: true, value: null });
    },
    nowMs: () => clockMs,
  };
}

async function storeFrame(store: MemoryStore, slotStart: number, ships: ShipRecord[], frameTimeMs: number): Promise<void> {
  const encoded = encodeShipFrame({ frameTimeMs, ships });
  ok(encoded.ok);
  const compressed = await gzipBytes(encoded.value);
  ok(compressed.ok);
  store.objects.set(frameObjectPath(slotStart), { bytes: compressed.value, cacheSeconds: 60 });
}

async function readStoredFrame(store: MemoryStore, slotStart: number): Promise<ShipRecord[]> {
  const object = store.objects.get(frameObjectPath(slotStart));
  ok(object !== undefined);
  const raw = await gunzipBytes(object.bytes);
  ok(raw.ok);
  const decoded = decodeShipFrame(raw.value);
  ok(decoded.ok);
  return readShipRecords(decoded.value);
}

Deno.test("merges the feeds with the previous frame, seals it, prunes, indexes and upserts statics", async () => {
  const store: MemoryStore = { objects: new Map(), upserted: [], listings: 0 };
  const previousSlot = SLOT_START_MS - SLOT_MS;
  const quietShip: ShipRecord = {
    mmsi: 444_000_001,
    longitude: 1.5,
    latitude: 51.1,
    speedKnots: 0,
    courseDegrees: null,
    headingDegrees: null,
    shipClass: "cargo",
    reportedAtMs: RUN_START_MS - 20 * 60_000,
    source: "aisstream",
  };
  await storeFrame(store, previousSlot, [quietShip], previousSlot + 5 * 60_000);
  const expiredSlot = slotStartMs(RUN_START_MS - 48 * 60 * 60_000);
  store.objects.set(frameObjectPath(expiredSlot), { bytes: new Uint8Array([1]), cacheSeconds: 60 });

  const summary = await collectShipFrame(
    createPorts(
      store,
      [
        positionMessage(555_000_001, 3.0, 52.0, RUN_START_MS + 10_000),
        positionMessage(555_000_002, 3.1, 52.1, RUN_START_MS + 12_000),
        staticMessage(555_000_002, 70),
        // Inside the Digitraffic box: Digitraffic's report of the same ship must win.
        positionMessage(230_000_001, 24.9, 60.1, RUN_START_MS + 20_000),
        "not json",
      ],
      [{ type: "Feature", geometry: { type: "Point", coordinates: [24.95, 60.15] }, properties: { mmsi: 230_000_001, sog: 10.1, cog: 360, heading: 511, timestampExternal: RUN_START_MS + 5_000 } }],
    ),
    { listenMs: 40_000 },
  );

  deepStrictEqual(summary.errors, []);
  equal(summary.ok, true);
  equal(summary.shipCount, 4);
  equal(summary.framePath, frameObjectPath(SLOT_START_MS));
  equal(summary.sealedFramePath, frameObjectPath(previousSlot));
  equal(summary.deletedFrames, 1);
  equal(store.objects.has(frameObjectPath(expiredSlot)), false);
  equal(store.objects.get(frameObjectPath(previousSlot))?.cacheSeconds, 24 * 60 * 60);
  equal(store.objects.get(frameObjectPath(SLOT_START_MS))?.cacheSeconds, 60);

  const ships = await readStoredFrame(store, SLOT_START_MS);
  const byMmsi = new Map(ships.map((ship) => [ship.mmsi, ship]));
  equal(byMmsi.get(444_000_001)?.shipClass, "cargo");
  equal(byMmsi.get(555_000_001)?.shipClass, "tanker");
  equal(byMmsi.get(555_000_002)?.shipClass, "cargo");
  deepStrictEqual(
    { source: byMmsi.get(230_000_001)?.source, shipClass: byMmsi.get(230_000_001)?.shipClass, courseDegrees: byMmsi.get(230_000_001)?.courseDegrees },
    { source: "digitraffic", shipClass: "passenger", courseDegrees: null },
  );

  const indexObject = store.objects.get(FRAME_INDEX_PATH);
  ok(indexObject !== undefined);
  const frameIndex = parseFrameIndex(JSON.parse(new TextDecoder().decode(indexObject.bytes)));
  ok(frameIndex.ok);
  deepStrictEqual(frameIndex.value.frames.map((entry) => entry.slotStartMs), [previousSlot, SLOT_START_MS]);

  deepStrictEqual(store.upserted.map((staticData) => staticData.mmsi).sort((first, second) => first - second), [230_000_001, 555_000_002]);
  // First run: no index yet, so the folder was listed once.
  equal(store.listings, 1);

  // Next slot: the index alone tells the run what is stored, and this slot's frame gets sealed.
  const nextRunStartMs = RUN_START_MS + SLOT_MS;
  const nextSummary = await collectShipFrame(createPorts(store, [positionMessage(555_000_003, 4.0, 53.0, nextRunStartMs + 1_000)], [], nextRunStartMs), { listenMs: 40_000 });
  deepStrictEqual(nextSummary.errors, []);
  equal(store.listings, 1);
  equal(nextSummary.previousFramePath, frameObjectPath(SLOT_START_MS));
  equal(nextSummary.sealedFramePath, frameObjectPath(SLOT_START_MS));
  // Ships heard 10 minutes ago are carried forward; 444000001, last heard 30 minutes 40 seconds before this frame, is gone.
  deepStrictEqual((await readStoredFrame(store, SLOT_START_MS + SLOT_MS)).map((ship) => ship.mmsi), [230_000_001, 555_000_001, 555_000_002, 555_000_003]);
});

Deno.test("compares aisstream with Digitraffic inside the cross-check regions and stores one sample each", async () => {
  const store: MemoryStore = { objects: new Map(), upserted: [], listings: 0 };
  const gulf = { id: "gulf-of-finland", box: { west: 22.0, east: 30.5, south: 59.0, north: 60.8 } };
  const summary = await collectShipFrame(
    createPorts(
      store,
      [
        // Heard by both feeds 5 s apart: a matched pair.
        positionMessage(230_000_001, 24.9, 60.1, RUN_START_MS + 10_000),
        // Heard by aisstream only.
        positionMessage(230_000_002, 25.5, 59.9, RUN_START_MS + 12_000),
        // Outside the Gulf: not compared.
        positionMessage(555_000_001, 3.0, 52.0, RUN_START_MS + 10_000),
        // A class B transponder and a fishing vessel, heard by aisstream only: Digitraffic publishes neither, so
        // neither is compared.
        positionMessage(230_000_003, 25.1, 60.0, RUN_START_MS + 11_000).replaceAll("PositionReport", "StandardClassBPositionReport"),
        positionMessage(230_000_004, 25.2, 60.0, RUN_START_MS + 11_000),
        staticMessage(230_000_004, 30),
      ],
      [{ type: "Feature", geometry: { type: "Point", coordinates: [24.9, 60.1] }, properties: { mmsi: 230_000_001, sog: 8.2, cog: 12.5, heading: 13, timestampExternal: RUN_START_MS + 15_000 } }],
    ),
    { listenMs: 40_000, crossCheckRegions: [gulf] },
  );
  deepStrictEqual(summary.errors, []);
  equal(store.crossSource?.length, 1);
  const sample = store.crossSource?.[0];
  ok(sample !== undefined);
  deepStrictEqual(
    { regionId: sample.regionId, aisstreamShips: sample.aisstreamShips, digitrafficShips: sample.digitrafficShips, shared: sample.sharedShips, only: sample.aisstreamOnlyShips, pairs: sample.matchedPairs },
    { regionId: "gulf-of-finland", aisstreamShips: 2, digitrafficShips: 1, shared: 1, only: 1, pairs: 1 },
  );
  // 5 s at 8.2 knots is 21 m of dead reckoning north-north-east, away from Digitraffic's identical fix.
  ok(sample.medianOffsetMetres !== null && sample.medianOffsetMetres > 15 && sample.medianOffsetMetres < 30);
});

Deno.test("keeps the stored frames when neither feed brought anything", async () => {
  const store: MemoryStore = { objects: new Map(), upserted: [], listings: 0 };
  const ports = createPorts(store, [], []);
  const summary = await collectShipFrame(
    {
      ...ports,
      listen: () => Promise.resolve({ ok: false, reason: "aisstream closed the connection (code 1008)" }),
      fetchDigitrafficLocations: () => Promise.resolve({ ok: false, reason: "Digitraffic answered 503" }),
    },
    { listenMs: 40_000 },
  );
  equal(summary.ok, false);
  equal(summary.framePath, null);
  equal(store.objects.size, 0);
  deepStrictEqual(summary.errors, [
    "aisstream closed the connection (code 1008)",
    "Digitraffic answered 503",
    "no new reports from aisstream or Digitraffic; frame not written",
  ]);
});

Deno.test("lists the folder once a day to delete a frame the index lost", async () => {
  const store: MemoryStore = { objects: new Map(), upserted: [], listings: 0 };
  const reconcileRunStartMs = Date.UTC(2026, 9, 18, 3, 1);
  const orphanSlot = slotStartMs(reconcileRunStartMs - 48 * 60 * 60_000);
  store.objects.set(frameObjectPath(orphanSlot), { bytes: new Uint8Array([1]), cacheSeconds: 60 });
  store.objects.set(FRAME_INDEX_PATH, { bytes: new TextEncoder().encode(JSON.stringify({ version: 1, generatedAtMs: reconcileRunStartMs, slotMinutes: 10, frames: [], credits: [] })), cacheSeconds: 60 });
  const summary = await collectShipFrame(createPorts(store, [positionMessage(555_000_009, 4.0, 53.0, reconcileRunStartMs + 1_000)], [], reconcileRunStartMs), { listenMs: 40_000 });
  deepStrictEqual(summary.errors, []);
  equal(store.listings, 1);
  equal(summary.deletedFrames, 1);
  equal(store.objects.has(frameObjectPath(orphanSlot)), false);
});
