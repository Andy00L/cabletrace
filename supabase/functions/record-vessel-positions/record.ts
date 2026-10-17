// One minute of near-cable recording for every watched region (src/data/regions): Digitraffic for the regions recorded
// from it, a regional aisstream listen for the others, both at once; then one call to public.ingest_vessel_positions,
// which keeps the reports within each region's near-cable distance. Database and network come in as ports, so the
// tests run this exact code with in-memory stores.
import type { Result } from "../../../src/lib/result.ts";
import { parseAisstreamMessage, parseDigitrafficPositions, parseDigitrafficVessels, type ShipStatic } from "../../../src/lib/live/ais-reports.ts";
import type { AisstreamBoundingBox, ListenStats } from "../collect-ship-frames/aisstream-listener.ts";
import { toAisstreamBoundingBoxes, type Region } from "@/lib/regions/region";
import { boxesForSource, selectRecordableReports, toRecorderReport, type RecorderReport } from "@/lib/regions/recording";

// Reports are re-requested with this overlap so a slow call never leaves a gap; duplicates are ignored by the primary key.
const RESUME_OVERLAP_MS = 5_000;
// Without a stored cursor (first run), Digitraffic is asked for the last 5 minutes only.
const FIRST_RUN_LOOKBACK_MS = 5 * 60_000;
// Static vessel data changes slowly: refresh it at most once an hour.
export const VESSEL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export type RecorderState = { lastReportMs: number | null; lastVesselRefreshMs: number | null };

export type SourceCounts = {
  digitraffic: { received: number; recordable: number } | null;
  aisstream: { messages: number; positions: number; recordable: number; connections: number; closedEarly: string | null; extensions: string } | null;
};

export type RecorderRun = {
  receivedCount: number;
  inRegionCount: number;
  storedCount: number;
  vesselsUpdatedCount: number;
  sourceCounts: SourceCounts;
  errors: string[];
};

export type RecorderPorts = {
  readState: () => Promise<Result<RecorderState>>;
  writeState: (state: RecorderState) => Promise<Result<null>>;
  ingestReports: (reports: RecorderReport[]) => Promise<Result<number>>;
  upsertVessels: (vessels: ShipStatic[]) => Promise<Result<number>>;
  insertRun: (run: RecorderRun) => Promise<Result<null>>;
  fetchDigitrafficLocations: (sinceMs: number) => Promise<Result<unknown>>;
  fetchDigitrafficVessels: (sinceMs: number | null) => Promise<Result<unknown>>;
  // Null when no aisstream key is configured: the aisstream regions are then skipped with an error.
  listenAisstream:
    | ((options: { boundingBoxes: AisstreamBoundingBox[]; listenMs: number; onMessageText: (messageText: string) => void }) => Promise<Result<ListenStats>>)
    | null;
  nowMs: () => number;
};

type FeedOutcome = { reports: RecorderReport[]; errors: string[] };

async function readDigitraffic(ports: RecorderPorts, regions: readonly Region[], state: RecorderState, nowMs: number) {
  if (boxesForSource(regions, "digitraffic").length === 0) return { outcome: { reports: [], errors: [] }, newestReportMs: state.lastReportMs, received: null };
  const sinceMs = state.lastReportMs === null ? nowMs - FIRST_RUN_LOOKBACK_MS : state.lastReportMs - RESUME_OVERLAP_MS;
  const fetched = await ports.fetchDigitrafficLocations(sinceMs);
  const parsed = fetched.ok ? parseDigitrafficPositions(fetched.value, sinceMs) : fetched;
  if (!parsed.ok) return { outcome: { reports: [], errors: [parsed.reason] }, newestReportMs: state.lastReportMs, received: 0 };
  const reports = parsed.value.map(toRecorderReport);
  const newestReportMs = reports.reduce<number | null>((newest, report) => (newest === null || report.reportedAtMs > newest ? report.reportedAtMs : newest), state.lastReportMs);
  return { outcome: { reports, errors: [] }, newestReportMs, received: reports.length };
}

async function readAisstream(ports: RecorderPorts, regions: readonly Region[], listenMs: number) {
  const boxes = boxesForSource(regions, "aisstream");
  if (boxes.length === 0) return { outcome: { reports: [], errors: [] }, stats: null };
  if (ports.listenAisstream === null) return { outcome: { reports: [], errors: ["AISSTREAM_API_KEY missing; aisstream regions not recorded"] }, stats: null };
  const reports: RecorderReport[] = [];
  const serverErrors: string[] = [];
  const listened = await ports.listenAisstream({
    boundingBoxes: toAisstreamBoundingBoxes(boxes),
    listenMs,
    onMessageText: (messageText) => {
      const message = parseAisstreamMessage(messageText);
      if (message.kind === "position") reports.push(toRecorderReport(message));
      else if (message.kind === "server-error" && serverErrors.length < 5) serverErrors.push(`aisstream error: ${message.reason}`);
    },
  });
  const errors = listened.ok ? serverErrors : [listened.reason, ...serverErrors];
  return { outcome: { reports, errors }, stats: listened.ok ? listened.value : null };
}

async function refreshVessels(ports: RecorderPorts, regions: readonly Region[], state: RecorderState, nowMs: number): Promise<Result<number>> {
  // Digitraffic's vessel list names the ships of the regions it records; aisstream regions read names and types from
  // the frame collector's public.live_ships instead (public.detection_inputs falls back to it).
  if (boxesForSource(regions, "digitraffic").length === 0) return { ok: true, value: 0 };
  if (state.lastVesselRefreshMs !== null && nowMs - state.lastVesselRefreshMs < VESSEL_REFRESH_INTERVAL_MS) return { ok: true, value: 0 };
  const fetched = await ports.fetchDigitrafficVessels(state.lastVesselRefreshMs);
  const parsed = fetched.ok ? parseDigitrafficVessels(fetched.value) : fetched;
  if (!parsed.ok) return parsed;
  if (parsed.value.length === 0) return { ok: true, value: 0 };
  // ShipStatic carries the keys public.upsert_vessels reads (mmsi, name, shipType, callSign, imo, destination, draughtMetres).
  return ports.upsertVessels(parsed.value.map((vessel) => vessel.staticData));
}

/** Runs one recording minute. Never throws; every failure lands in `errors` and in public.recorder_runs. */
export async function recordRegions(ports: RecorderPorts, { regions, listenMs }: { regions: readonly Region[]; listenMs: number }): Promise<RecorderRun> {
  const nowMs = ports.nowMs();
  const state = await ports.readState();
  if (!state.ok) {
    const failed: RecorderRun = { receivedCount: 0, inRegionCount: 0, storedCount: 0, vesselsUpdatedCount: 0, sourceCounts: { digitraffic: null, aisstream: null }, errors: [state.reason] };
    await ports.insertRun(failed);
    return failed;
  }
  // Digitraffic is one HTTP call; aisstream listens for listenMs. Run both at once so the minute holds them.
  const [digitraffic, aisstream] = await Promise.all([readDigitraffic(ports, regions, state.value, nowMs), readAisstream(ports, regions, listenMs)]);
  const received = [...digitraffic.outcome.reports, ...aisstream.outcome.reports];
  const recordable = selectRecordableReports(regions, received);
  const errors = [...digitraffic.outcome.errors, ...aisstream.outcome.errors];

  let storedCount = 0;
  if (recordable.length > 0) {
    const stored = await ports.ingestReports(recordable);
    if (stored.ok) storedCount = stored.value;
    else errors.push(stored.reason);
  }
  const vessels = await refreshVessels(ports, regions, state.value, nowMs);
  if (!vessels.ok) errors.push(vessels.reason);
  const hasRefreshed = vessels.ok && boxesForSource(regions, "digitraffic").length > 0 && (state.value.lastVesselRefreshMs === null || nowMs - state.value.lastVesselRefreshMs >= VESSEL_REFRESH_INTERVAL_MS);

  const written = await ports.writeState({ lastReportMs: digitraffic.newestReportMs, lastVesselRefreshMs: hasRefreshed ? nowMs : state.value.lastVesselRefreshMs });
  if (!written.ok) errors.push(written.reason);

  const countRecordable = (source: RecorderReport["source"]) => recordable.filter((report) => report.source === source).length;
  const run: RecorderRun = {
    receivedCount: received.length,
    inRegionCount: recordable.length,
    storedCount,
    vesselsUpdatedCount: vessels.ok ? vessels.value : 0,
    sourceCounts: {
      digitraffic: digitraffic.received === null ? null : { received: digitraffic.received, recordable: countRecordable("digitraffic") },
      aisstream:
        aisstream.stats === null
          ? null
          : {
              messages: aisstream.stats.messageCount,
              positions: aisstream.outcome.reports.length,
              recordable: countRecordable("aisstream"),
              connections: aisstream.stats.connections,
              closedEarly: aisstream.stats.closedEarly,
              extensions: aisstream.stats.extensions,
            },
    },
    errors,
  };
  const inserted = await ports.insertRun(run);
  if (!inserted.ok) run.errors.push(inserted.reason);
  return run;
}
