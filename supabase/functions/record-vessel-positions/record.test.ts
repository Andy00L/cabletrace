// Orchestration tests for recordRegions and archivePositions with in-memory ports (no network, no Supabase).
// Run: deno test --no-lock --config supabase/functions/record-vessel-positions/deno.json supabase/functions/record-vessel-positions/
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import type { Result } from "../../../src/lib/result.ts";
import type { ShipStatic } from "../../../src/lib/live/ais-reports.ts";
import { gunzipBytes } from "../../../src/lib/live/frame-compression.ts";
import type { Region } from "@/lib/regions/region";
import type { RecorderReport } from "@/lib/regions/recording";
import { archivePositions, type ArchiveEntry, type ArchivePorts } from "./archive.ts";
import { recordRegions, type RecorderPorts, type RecorderRun, type RecorderState } from "./record.ts";

const NOW_MS = Date.UTC(2026, 9, 19, 10, 0, 30);
const THRESHOLDS = { nearCableMetres: 3000, stationaryKnots: 0.5, stationaryRepeatMinutes: 10, stationaryRepeatMetres: 50, hotRetentionHours: 72 };
const DIGITRAFFIC_REGION: Region = {
  id: "test-gulf",
  name: "Test gulf",
  box: { west: 22, east: 30.5, south: 59, north: 60.8 },
  timeZone: "Europe/Helsinki",
  liveSources: ["digitraffic"],
  lineSources: ["openstreetmap"],
  recording: THRESHOLDS,
  seabedAreaIds: [],
  incidents: [],
  reason: "test",
};
const AISSTREAM_REGION: Region = { ...DIGITRAFFIC_REGION, id: "test-strait", box: { west: 9.5, east: 13, south: 54.3, north: 58 }, liveSources: ["aisstream"] };

function formatAisstreamTime(timeMs: number): string {
  return `${new Date(timeMs).toISOString().replace("T", " ").replace("Z", "")}000 +0000 UTC`;
}

function positionMessage(mmsi: number, longitude: number, latitude: number, timeMs: number): string {
  return JSON.stringify({
    Message: { PositionReport: { Cog: 90, Latitude: latitude, Longitude: longitude, Sog: 6.1, TrueHeading: 92, NavigationalStatus: 0, RateOfTurn: 3, UserID: mmsi, Valid: true } },
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, time_utc: formatAisstreamTime(timeMs) },
  });
}

function digitrafficFeature(mmsi: number, longitude: number, latitude: number, timeMs: number) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] }, properties: { mmsi, sog: 4.2, cog: 271, heading: 270, navStat: 0, rot: 0, timestampExternal: timeMs } };
}

type Memory = { state: RecorderState; ingested: RecorderReport[][]; vessels: ShipStatic[]; runs: RecorderRun[]; listenedBoxes: unknown[]; digitrafficSince: number[] };

function createPorts(memory: Memory, messages: string[], features: unknown[]): RecorderPorts {
  return {
    readState: () => Promise.resolve({ ok: true, value: memory.state }),
    writeState: (state) => {
      memory.state = state;
      return Promise.resolve({ ok: true, value: null });
    },
    ingestReports: (reports) => {
      memory.ingested.push(reports);
      return Promise.resolve({ ok: true, value: reports.length });
    },
    upsertVessels: (vessels) => {
      memory.vessels.push(...vessels);
      return Promise.resolve({ ok: true, value: vessels.length });
    },
    insertRun: (run) => {
      memory.runs.push(run);
      return Promise.resolve({ ok: true, value: null });
    },
    fetchDigitrafficLocations: (sinceMs) => {
      memory.digitrafficSince.push(sinceMs);
      return Promise.resolve({ ok: true, value: { type: "FeatureCollection", features } });
    },
    fetchDigitrafficVessels: () => Promise.resolve({ ok: true, value: [{ mmsi: 230_000_001, name: "FINNMAID", shipType: 69, draught: 64, timestamp: NOW_MS }] }),
    listenAisstream: ({ boundingBoxes, onMessageText }) => {
      memory.listenedBoxes.push(boundingBoxes);
      messages.forEach(onMessageText);
      return Promise.resolve({ ok: true, value: { openedAfterMs: 1, listenedMs: 40_000, messageCount: messages.length, messageBytes: 0, extensions: "permessage-deflate", closedEarly: null, connections: 1 } });
    },
    nowMs: () => NOW_MS,
  };
}

function emptyMemory(): Memory {
  return { state: { lastReportMs: NOW_MS - 60_000, lastVesselRefreshMs: null }, ingested: [], vessels: [], runs: [], listenedBoxes: [], digitrafficSince: [] };
}

Deno.test("records each region from its own feed, one report per ship, in one ingest call", async () => {
  const memory = emptyMemory();
  const run = await recordRegions(
    createPorts(
      memory,
      [
        positionMessage(219_000_001, 11.0, 56.0, NOW_MS - 30_000),
        // A newer report of the same ship replaces the older one.
        positionMessage(219_000_001, 11.01, 56.0, NOW_MS - 10_000),
        // Inside the Gulf, but the Gulf is recorded from Digitraffic: not stored from aisstream.
        positionMessage(230_000_009, 25.0, 60.0, NOW_MS - 10_000),
        "not json",
      ],
      [
        digitrafficFeature(230_000_001, 25.0, 60.0, NOW_MS - 20_000),
        // Digitraffic also sees ships outside the Gulf box: not stored.
        digitrafficFeature(265_000_001, 18.0, 58.0, NOW_MS - 20_000),
      ],
    ),
    { regions: [DIGITRAFFIC_REGION, AISSTREAM_REGION], listenMs: 40_000 },
  );
  deepStrictEqual(run.errors, []);
  deepStrictEqual(memory.listenedBoxes, [[[[54.3, 9.5], [58, 13]]]]);
  equal(memory.digitrafficSince[0], NOW_MS - 60_000 - 5_000);
  equal(memory.ingested.length, 1);
  deepStrictEqual(
    memory.ingested[0]?.map((report) => [report.mmsi, report.source, report.longitude, report.navigationStatus, report.turnRate]),
    [
      [219_000_001, "aisstream", 11.01, 0, 3],
      [230_000_001, "digitraffic", 25.0, 0, 0],
    ],
  );
  equal(run.receivedCount, 5);
  equal(run.inRegionCount, 2);
  equal(run.storedCount, 2);
  deepStrictEqual(run.sourceCounts.digitraffic, { received: 2, recordable: 1 });
  equal(run.sourceCounts.aisstream?.positions, 3);
  equal(memory.state.lastReportMs, NOW_MS - 20_000);
  equal(memory.state.lastVesselRefreshMs, NOW_MS);
  equal(memory.vessels[0]?.mmsi, 230_000_001);
  equal(memory.runs.length, 1);
});

Deno.test("keeps recording Digitraffic when no aisstream key is set, and says so", async () => {
  const memory = emptyMemory();
  const ports = { ...createPorts(memory, [], [digitrafficFeature(230_000_001, 25.0, 60.0, NOW_MS - 20_000)]), listenAisstream: null };
  const run = await recordRegions(ports, { regions: [DIGITRAFFIC_REGION, AISSTREAM_REGION], listenMs: 40_000 });
  deepStrictEqual(run.errors, ["AISSTREAM_API_KEY missing; aisstream regions not recorded"]);
  equal(run.storedCount, 1);
  equal(run.sourceCounts.aisstream, null);
});

Deno.test("leaves the Digitraffic cursor where it was when Digitraffic fails", async () => {
  const memory = emptyMemory();
  const ports: RecorderPorts = { ...createPorts(memory, [], []), fetchDigitrafficLocations: () => Promise.resolve({ ok: false, reason: "Digitraffic answered 503" }) };
  const run = await recordRegions(ports, { regions: [DIGITRAFFIC_REGION], listenMs: 40_000 });
  deepStrictEqual(run.errors, ["Digitraffic answered 503"]);
  equal(memory.state.lastReportMs, NOW_MS - 60_000);
  equal(memory.ingested.length, 0);
});

type ArchiveMemory = { objects: Map<string, Uint8Array>; entries: ArchiveEntry[]; forgotten: string[] };

function createArchivePorts(memory: ArchiveMemory, overrides: Partial<ArchivePorts> = {}): ArchivePorts {
  return {
    listPendingDays: () => Promise.resolve({ ok: true, value: [{ regionId: "test-gulf", day: "2026-10-17" }] }),
    readDayDocument: (day) => Promise.resolve({ ok: true, value: { version: 1, kind: "day", regionId: day.regionId, day: day.day, rowCount: 2, rows: [[1], [2]] } }),
    listPendingTracks: () => Promise.resolve({ ok: true, value: [{ detectionId: 42, regionId: "test-gulf" }] }),
    readTrackDocument: () => Promise.resolve({ ok: true, value: { version: 1, kind: "detection", detectionId: 42, rowCount: 1, rows: [[1]] } }),
    writeObject: (objectPath, bytes) => {
      memory.objects.set(objectPath, bytes);
      return Promise.resolve({ ok: true, value: null });
    },
    recordArchive: (entry) => {
      memory.entries.push(entry);
      return Promise.resolve({ ok: true, value: null });
    },
    listExpiredDays: () => Promise.resolve({ ok: true, value: ["days/test-gulf/2026-09-01.json.gz"] }),
    deleteObjects: (paths): Promise<Result<null>> => {
      paths.forEach((path) => memory.objects.delete(path));
      return Promise.resolve({ ok: true, value: null });
    },
    forgetArchives: (paths) => {
      memory.forgotten.push(...paths);
      return Promise.resolve({ ok: true, value: null });
    },
    ...overrides,
  };
}

Deno.test("archives days and alert tracks as gzip files, records them, and deletes expired days", async () => {
  const memory: ArchiveMemory = { objects: new Map(), entries: [], forgotten: [] };
  const summary = await archivePositions(createArchivePorts(memory));
  deepStrictEqual(summary.errors, []);
  equal(summary.daysArchived, 1);
  equal(summary.tracksKept, 1);
  equal(summary.rowsArchived, 3);
  deepStrictEqual([...memory.objects.keys()], ["days/test-gulf/2026-10-17.json.gz", "detections/42.json.gz"]);
  const dayBytes = memory.objects.get("days/test-gulf/2026-10-17.json.gz");
  ok(dayBytes !== undefined);
  const unzipped = await gunzipBytes(dayBytes);
  ok(unzipped.ok);
  equal(JSON.parse(new TextDecoder().decode(unzipped.value)).rowCount, 2);
  deepStrictEqual(memory.entries.map((entry) => [entry.kind, entry.objectPath, entry.rowCount, entry.byteCount === dayBytes.byteLength || entry.kind === "detection"]), [
    ["day", "days/test-gulf/2026-10-17.json.gz", 2, true],
    ["detection", "detections/42.json.gz", 1, true],
  ]);
  deepStrictEqual(memory.forgotten, ["days/test-gulf/2026-09-01.json.gz"]);
});

Deno.test("does not record a day whose upload failed, so its rows stay in the hot table", async () => {
  const memory: ArchiveMemory = { objects: new Map(), entries: [], forgotten: [] };
  const summary = await archivePositions(
    createArchivePorts(memory, {
      writeObject: (objectPath) => Promise.resolve({ ok: false, reason: `upload of ${objectPath} failed: quota` }),
      listPendingTracks: () => Promise.resolve({ ok: true, value: [] }),
      listExpiredDays: () => Promise.resolve({ ok: true, value: [] }),
    }),
  );
  deepStrictEqual(summary.errors, ["upload of days/test-gulf/2026-10-17.json.gz failed: quota"]);
  equal(memory.entries.length, 0);
});
