// One collector run: listen to aisstream, add Digitraffic, merge with the newest stored frame, write
// the frame of the current 10-minute slot, seal the previous one, delete expired frames, rewrite
// index.json and upsert ship static data. Storage, database and network come in as ports, so the
// local CPU harness runs this exact code with in-memory stores.
import type { Result } from "../../../src/lib/result.ts";
import {
  mergeShipStatics,
  parseAisstreamMessage,
  parseDigitrafficLocations,
  parseDigitrafficVessels,
  type DigitrafficVessel,
  type ShipStatic,
} from "../../../src/lib/live/ais-reports.ts";
import { compareFeeds, type Box, type CrossSourceSample } from "../../../src/lib/live/cross-source.ts";
import { gunzipBytes, gzipBytes } from "../../../src/lib/live/frame-compression.ts";
import {
  buildFrameIndex,
  FRAME_INDEX_PATH,
  frameObjectPath,
  parseFrameIndex,
  selectExpiredFrames,
  SLOT_MS,
  slotStartMs,
  type StoredFrame,
} from "../../../src/lib/live/frame-layout.ts";
import { shipClassFromAisType } from "../../../src/lib/live/ship-class.ts";
import { assignShipClasses, CARRY_FORWARD_MS, mergeShipRecords, pickPreferredReport } from "../../../src/lib/live/ship-merge.ts";
import { decodeShipFrame, encodeShipFrame, readShipRecords, type ShipClass, type ShipRecord } from "../../../src/lib/live/snapshot-codec.ts";
import type { ListenStats } from "./aisstream-listener.ts";

// The frame of the slot still filling is rewritten by later runs: short cache. A sealed frame never
// changes again; one day of cache keeps it inside the 2-day retention (FRAME_RETENTION_MS is 47 h).
const OPEN_FRAME_CACHE_SECONDS = 60;
const SEALED_FRAME_CACHE_SECONDS = 24 * 60 * 60;
const INDEX_CACHE_SECONDS = 60;
const FRAME_CONTENT_TYPE = "application/octet-stream";
const INDEX_CONTENT_TYPE = "application/json";
// Bounds one database call: the class lookup takes an integer array, the upsert a JSON array.
const CLASS_LOOKUP_LIMIT = 5_000;
const STATIC_UPSERT_BATCH = 1_000;
// Once a day (the run of the 03:00 UTC slot) the folder is listed instead of trusting index.json, so a
// frame whose index update failed is still found and deleted within the 2-day limit.
const RECONCILE_SLOT_OF_DAY_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type FrameStore = {
  // Fallback only: index.json is the record of stored frames; a listing costs egress per object.
  listFrames: () => Promise<Result<StoredFrame[]>>;
  // Null when the object does not exist.
  readObject: (objectPath: string) => Promise<Result<Uint8Array | null>>;
  writeObject: (objectPath: string, bytes: Uint8Array, contentType: string, cacheSeconds: number) => Promise<Result<null>>;
  deleteObjects: (objectPaths: string[]) => Promise<Result<null>>;
};

export type ShipStaticStore = {
  upsertStatics: (statics: ShipStatic[]) => Promise<Result<number>>;
  // AIS ship type per MMSI, for ships whose static message arrived in an earlier run.
  readShipTypes: (mmsis: number[]) => Promise<Result<Map<number, number>>>;
};

export type CollectorPorts = {
  frames: FrameStore;
  statics: ShipStaticStore;
  listen: (options: { listenMs: number; onMessageText: (messageText: string) => void }) => Promise<Result<ListenStats>>;
  fetchDigitrafficLocations: (sinceMs: number) => Promise<Result<unknown>>;
  fetchDigitrafficVessels: () => Promise<Result<unknown>>;
  // One row per sample into public.cross_source_samples (supabase/migrations/20261019200000_regional_recording.sql).
  storeCrossSourceSamples: (samples: CrossSourceSample[]) => Promise<Result<null>>;
  nowMs: () => number;
};

/** A region both feeds cover, where the run compares them (regions recorded from Digitraffic, src/data/regions). */
export type CrossCheckRegion = { id: string; box: Box };

export type CollectSummary = {
  ok: boolean;
  frameTimeMs: number;
  framePath: string | null;
  shipCount: number;
  aisstreamShips: number;
  digitrafficShips: number;
  reportedBeforeRunShips: number;
  unknownClassShips: number;
  frameBytes: number;
  compressedBytes: number;
  aisstream: {
    messages: number;
    messageBytes: number;
    positions: number;
    statics: number;
    ignored: Record<string, number>;
    extensions: string;
    closedEarly: string | null;
    connections: number;
  };
  digitrafficReports: number;
  previousFramePath: string | null;
  sealedFramePath: string | null;
  deletedFrames: number;
  indexedFrames: number;
  staticsUpserted: number;
  crossSource: CrossSourceSample[];
  errors: string[];
};

type AisstreamAccumulator = {
  addMessage: (messageText: string) => void;
  positions: Map<number, ShipRecord>;
  statics: ShipStatic[];
  ignored: Map<string, number>;
  serverErrors: string[];
  positionCount: () => number;
};

// Folds messages as they arrive, keeping one position per ship, so memory stays at one entry per
// ship (about 10,000) rather than one per message.
function createAisstreamAccumulator(): AisstreamAccumulator {
  const positions = new Map<number, ShipRecord>();
  const statics: ShipStatic[] = [];
  const ignored = new Map<string, number>();
  const serverErrors: string[] = [];
  let positionMessages = 0;
  const addMessage = (messageText: string) => {
    const message = parseAisstreamMessage(messageText);
    if (message.kind === "position") {
      positionMessages += 1;
      positions.set(message.report.mmsi, pickPreferredReport(positions.get(message.report.mmsi), message.report));
      if (message.staticData !== null) statics.push(message.staticData);
    } else if (message.kind === "static") {
      statics.push(message.staticData);
    } else if (message.kind === "server-error") {
      if (serverErrors.length < 5) serverErrors.push(message.reason);
    } else {
      ignored.set(message.reason, (ignored.get(message.reason) ?? 0) + 1);
    }
  };
  return { addMessage, positions, statics, ignored, serverErrors, positionCount: () => positionMessages };
}

type PreviousFrame = { slotStartMs: number; path: string; compressed: Uint8Array; frameTimeMs: number; ships: ShipRecord[] };

type StoredState = { stored: StoredFrame[]; previous: PreviousFrame | null };

function parseIndexBytes(indexBytes: Uint8Array): Result<StoredFrame[]> {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(indexBytes));
  } catch {
    return { ok: false, reason: "index.json is not JSON" };
  }
  const frameIndex = parseFrameIndex(payload);
  if (!frameIndex.ok) return frameIndex;
  return { ok: true, value: frameIndex.value.frames.map((entry) => ({ slotStartMs: entry.slotStartMs, bytes: entry.bytes })) };
}

// Reads the stored frames from index.json; lists the folder when the index is missing (first run) or
// unreadable, and once a day, so frames the index lost are still deleted on time.
async function readStoredFrames(frames: FrameStore, runStartMs: number, errors: string[]): Promise<StoredFrame[]> {
  const isReconcileRun = slotStartMs(runStartMs) % DAY_MS === RECONCILE_SLOT_OF_DAY_MS;
  if (!isReconcileRun) {
    const indexBytes = await frames.readObject(FRAME_INDEX_PATH);
    if (!indexBytes.ok) {
      errors.push(indexBytes.reason);
    } else if (indexBytes.value !== null) {
      const stored = parseIndexBytes(indexBytes.value);
      if (stored.ok) return stored.value;
      errors.push(`${stored.reason}; rebuilt from a listing`);
    }
  }
  const listing = await frames.listFrames();
  if (listing.ok) return listing.value;
  errors.push(listing.reason);
  return [];
}

// Loads the newest stored frame, unless it is too old to carry any ship forward (each download
// counts against the 5 GB egress quota, so a useless one is skipped).
async function loadStoredState(frames: FrameStore, runStartMs: number, errors: string[]): Promise<StoredState> {
  const stored = await readStoredFrames(frames, runStartMs, errors);
  const currentSlot = slotStartMs(runStartMs);
  const newest = stored
    .filter((frame) => frame.slotStartMs <= currentSlot)
    .reduce<StoredFrame | null>((latest, frame) => (latest === null || frame.slotStartMs > latest.slotStartMs ? frame : latest), null);
  if (newest === null || newest.slotStartMs + SLOT_MS < runStartMs - CARRY_FORWARD_MS) return { stored, previous: null };

  const path = frameObjectPath(newest.slotStartMs);
  const compressed = await frames.readObject(path);
  if (!compressed.ok || compressed.value === null) {
    errors.push(compressed.ok ? `previous frame ${path} is missing` : compressed.reason);
    return { stored, previous: null };
  }
  const raw = await gunzipBytes(compressed.value);
  const decoded = raw.ok ? decodeShipFrame(raw.value) : raw;
  if (!decoded.ok) {
    errors.push(`previous frame ${path} unreadable: ${decoded.reason}`);
    return { stored, previous: null };
  }
  return {
    stored,
    previous: { slotStartMs: newest.slotStartMs, path, compressed: compressed.value, frameTimeMs: decoded.value.frameTimeMs, ships: readShipRecords(decoded.value) },
  };
}

function buildClassMap(statics: readonly ShipStatic[]): Map<number, ShipClass> {
  const classByMmsi = new Map<number, ShipClass>();
  for (const staticData of statics) {
    const shipClass = shipClassFromAisType(staticData.shipType);
    if (shipClass !== "unknown") classByMmsi.set(staticData.mmsi, shipClass);
  }
  return classByMmsi;
}

// Ships that just appeared, with no type yet: their static message may have arrived in an earlier
// run, so the static table is asked once. Ships already in the previous frame kept their class there.
async function lookUpNewShipClasses(
  statics: ShipStaticStore,
  merged: readonly ShipRecord[],
  classByMmsi: Map<number, ShipClass>,
  previousMmsis: ReadonlySet<number>,
  errors: string[],
): Promise<void> {
  const unknownMmsis = merged
    .filter((ship) => ship.shipClass === "unknown" && !classByMmsi.has(ship.mmsi) && !previousMmsis.has(ship.mmsi))
    .map((ship) => ship.mmsi)
    .slice(0, CLASS_LOOKUP_LIMIT);
  if (unknownMmsis.length === 0) return;
  const shipTypes = await statics.readShipTypes(unknownMmsis);
  if (!shipTypes.ok) {
    errors.push(shipTypes.reason);
    return;
  }
  shipTypes.value.forEach((shipType, mmsi) => {
    const shipClass = shipClassFromAisType(shipType);
    if (shipClass !== "unknown") classByMmsi.set(mmsi, shipClass);
  });
}

async function upsertStaticsInBatches(statics: ShipStaticStore, rows: readonly ShipStatic[], errors: string[]): Promise<number> {
  let upserted = 0;
  for (let batchStart = 0; batchStart < rows.length; batchStart += STATIC_UPSERT_BATCH) {
    const outcome = await statics.upsertStatics(rows.slice(batchStart, batchStart + STATIC_UPSERT_BATCH));
    if (!outcome.ok) {
      errors.push(outcome.reason);
      return upserted;
    }
    upserted += outcome.value;
  }
  return upserted;
}

function countShips(ships: readonly ShipRecord[], runStartMs: number) {
  let aisstreamShips = 0;
  let digitrafficShips = 0;
  let reportedBeforeRunShips = 0;
  let unknownClassShips = 0;
  for (const ship of ships) {
    if (ship.source === "aisstream") aisstreamShips += 1;
    else digitrafficShips += 1;
    // Not heard during this run: carried from an earlier frame, or a Digitraffic position older than the run.
    if (ship.reportedAtMs < runStartMs) reportedBeforeRunShips += 1;
    if (ship.shipClass === "unknown") unknownClassShips += 1;
  }
  return { aisstreamShips, digitrafficShips, reportedBeforeRunShips, unknownClassShips };
}

// Compares the two feeds where both report, when both answered this run, and stores the samples.
async function sampleCrossSource(
  ports: CollectorPorts,
  regions: readonly CrossCheckRegion[],
  window: { startMs: number; endMs: number },
  feeds: { aisstream: readonly ShipRecord[]; digitraffic: readonly ShipRecord[] },
  errors: string[],
): Promise<CrossSourceSample[]> {
  if (regions.length === 0 || feeds.aisstream.length === 0 || feeds.digitraffic.length === 0) return [];
  const samples = regions.map((region) =>
    compareFeeds({ regionId: region.id, box: region.box, ...feeds, windowStartMs: window.startMs, sampledAtMs: window.endMs }),
  );
  const stored = await ports.storeCrossSourceSamples(samples);
  if (!stored.ok) errors.push(stored.reason);
  return samples;
}

/** Runs one collection. Never throws; every failure lands in `errors` and `ok` is false. */
export async function collectShipFrame(
  ports: CollectorPorts,
  { listenMs, crossCheckRegions = [] }: { listenMs: number; crossCheckRegions?: readonly CrossCheckRegion[] },
): Promise<CollectSummary> {
  const errors: string[] = [];
  const runStartMs = ports.nowMs();
  const accumulator = createAisstreamAccumulator();

  // The stored state loads while the socket listens; Digitraffic is asked afterwards so its
  // positions are as fresh as the frame time.
  const [storedState, listened] = await Promise.all([
    loadStoredState(ports.frames, runStartMs, errors),
    ports.listen({ listenMs, onMessageText: accumulator.addMessage }),
  ]);
  if (!listened.ok) errors.push(listened.reason);
  errors.push(...accumulator.serverErrors.map((reason) => `aisstream error: ${reason}`));

  const [locationsPayload, vesselsPayload] = await Promise.all([
    ports.fetchDigitrafficLocations(ports.nowMs() - CARRY_FORWARD_MS),
    ports.fetchDigitrafficVessels(),
  ]);
  const frameTimeMs = ports.nowMs();
  const locations = locationsPayload.ok ? parseDigitrafficLocations(locationsPayload.value, frameTimeMs - CARRY_FORWARD_MS) : locationsPayload;
  const vessels = vesselsPayload.ok ? parseDigitrafficVessels(vesselsPayload.value) : vesselsPayload;
  if (!locations.ok) errors.push(locations.reason);
  if (!vessels.ok) errors.push(vessels.reason);
  const digitrafficReports = locations.ok ? locations.value : [];
  const digitrafficVessels: DigitrafficVessel[] = vessels.ok ? vessels.value : [];
  const crossSource = await sampleCrossSource(
    ports,
    crossCheckRegions,
    { startMs: runStartMs, endMs: frameTimeMs },
    { aisstream: [...accumulator.positions.values()], digitraffic: digitrafficReports },
    errors,
  );
  // Nothing new from either feed (both down, or the key refused): keep the stored frames as they are
  // rather than publish a frame that only repeats old positions or shows an empty globe.
  const hasNewReports = accumulator.positions.size > 0 || digitrafficReports.length > 0;
  if (!hasNewReports) errors.push("no new reports from aisstream or Digitraffic; frame not written");

  const previous = storedState.previous;
  const previousShips = previous === null ? [] : previous.ships;
  const merged = mergeShipRecords({ frameTimeMs, previous: previousShips, incoming: [...accumulator.positions.values(), ...digitrafficReports] });

  // Aisstream statics come last so the newest message decides when both sources know a ship.
  const classByMmsi = buildClassMap(mergeShipStatics([...digitrafficVessels.map((vessel) => vessel.staticData), ...accumulator.statics]));
  if (hasNewReports) await lookUpNewShipClasses(ports.statics, merged, classByMmsi, new Set(previousShips.map((ship) => ship.mmsi)), errors);
  const ships = assignShipClasses(merged, classByMmsi);

  const summary: CollectSummary = {
    ok: false,
    frameTimeMs,
    framePath: null,
    shipCount: ships.length,
    ...countShips(ships, runStartMs),
    frameBytes: 0,
    compressedBytes: 0,
    aisstream: {
      messages: listened.ok ? listened.value.messageCount : 0,
      messageBytes: listened.ok ? listened.value.messageBytes : 0,
      positions: accumulator.positionCount(),
      statics: accumulator.statics.length,
      ignored: Object.fromEntries(accumulator.ignored),
      extensions: listened.ok ? listened.value.extensions : "",
      closedEarly: listened.ok ? listened.value.closedEarly : null,
      connections: listened.ok ? listened.value.connections : 0,
    },
    digitrafficReports: digitrafficReports.length,
    previousFramePath: previous === null ? null : previous.path,
    sealedFramePath: null,
    deletedFrames: 0,
    indexedFrames: 0,
    staticsUpserted: 0,
    crossSource,
    errors,
  };

  if (!hasNewReports) return summary;

  const encoded = encodeShipFrame({ frameTimeMs, ships });
  const compressed = encoded.ok ? await gzipBytes(encoded.value) : encoded;
  if (!compressed.ok) {
    errors.push(`frame not written: ${compressed.reason}`);
    return summary;
  }
  summary.frameBytes = encoded.ok ? encoded.value.byteLength : 0;
  summary.compressedBytes = compressed.value.byteLength;

  const currentSlot = slotStartMs(frameTimeMs);
  const framePath = frameObjectPath(currentSlot);
  const written = await ports.frames.writeObject(framePath, compressed.value, FRAME_CONTENT_TYPE, OPEN_FRAME_CACHE_SECONDS);
  if (!written.ok) {
    errors.push(written.reason);
    return summary;
  }
  summary.framePath = framePath;
  const storedBySlot = new Map(storedState.stored.map((frame) => [frame.slotStartMs, frame]));
  storedBySlot.set(currentSlot, { slotStartMs: currentSlot, bytes: compressed.value.byteLength });

  // The previous slot is over: rewrite its frame unchanged with a long cache so browsers and the CDN keep it.
  if (previous !== null && previous.slotStartMs < currentSlot) {
    const sealed = await ports.frames.writeObject(previous.path, previous.compressed, FRAME_CONTENT_TYPE, SEALED_FRAME_CACHE_SECONDS);
    if (sealed.ok) summary.sealedFramePath = previous.path;
    else errors.push(sealed.reason);
  }

  const expired = selectExpiredFrames([...storedBySlot.values()], frameTimeMs);
  if (expired.length > 0) {
    const deleted = await ports.frames.deleteObjects(expired.map((frame) => frameObjectPath(frame.slotStartMs)));
    if (deleted.ok) {
      summary.deletedFrames = expired.length;
      expired.forEach((frame) => storedBySlot.delete(frame.slotStartMs));
    } else {
      errors.push(deleted.reason);
    }
  }

  const frameIndex = buildFrameIndex([...storedBySlot.values()], frameTimeMs);
  const indexWritten = await ports.frames.writeObject(FRAME_INDEX_PATH, new TextEncoder().encode(JSON.stringify(frameIndex)), INDEX_CONTENT_TYPE, INDEX_CACHE_SECONDS);
  if (indexWritten.ok) summary.indexedFrames = frameIndex.frames.length;
  else errors.push(indexWritten.reason);

  // Digitraffic re-sends each vessel's metadata every few minutes; only entries received since the
  // previous frame are new. Every aisstream static message of this run is new by definition.
  const staticsSinceMs = previous === null ? frameTimeMs - CARRY_FORWARD_MS : previous.frameTimeMs;
  const freshDigitraffic = digitrafficVessels.filter((vessel) => vessel.updatedAtMs >= staticsSinceMs).map((vessel) => vessel.staticData);
  summary.staticsUpserted = await upsertStaticsInBatches(ports.statics, mergeShipStatics([...freshDigitraffic, ...accumulator.statics]), errors);

  summary.ok = errors.length === 0;
  return summary;
}
