// Backtest of the anchor-drag detector (src/lib/detection). Prints one table row per expectation and exits
// 0 when every expectation holds, 1 when one fails, 2 when the backtest could not run.
// Usage: bun scripts/backtest/run-backtest.ts
// The recorded-traffic check reads the live recorder through the Supabase Management API and needs
// SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the environment (SELECT statements only).
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { YI_PENG_3_2024 } from "@/data/cases/yi-peng-3-2024";
import { assessTrack } from "@/lib/detection/detect-anchor-drag";
import type { Detection, ShipSize, TrackAssessment, TrackPoint } from "@/lib/detection/detection-types";
import { DETECTION_INTERVAL_MS, DETECTION_LOOKBACK_MS } from "@/lib/detection/assess-fleet";
import { fetchRecordedTraffic, readQueryCredentials, replayRecordedTraffic } from "./recorded-traffic";
import { buildRedTeamCases } from "./red-team-tracks";
import { loadSeabedInputs, type SeabedInputs } from "./seabed-inputs";
import { YI_PENG_3_ARCHIVE_ROWS } from "./yi-peng-3-track";

// Expectations, each stated before the run.
// The detection must start no later than this after the first report it was given (the drag was already under way).
const START_TOLERANCE_MS = 5 * 60 * 1000;
// The detection must end within this of the published end of the drag window (the stop at 08:24 UTC).
const END_TOLERANCE_MS = 10 * 60 * 1000;
// Replayed on the live schedule, the first alert must come within this of the published end of the drag.
const LIVE_LATENCY_LIMIT_MS = 120 * 60 * 1000;
// Recorded traffic: fewer than this many alerts per region per day (one region, the Gulf of Finland).
const MAX_ALERTS_PER_REGION_DAY = 1;

// Yi Peng 3 from AIS: 224 m by 32 m, draught 14.5 m, antenna 189 m from the bow, type "Cargo" (DMA archive row of
// 18 Nov 2024 07:27:56, plan/research/yi-peng-3-reconstruction.md section 2).
const YI_PENG_3_SHIP: ShipSize = { lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 };
// Eagle S: 228.6 m by 32 m, oil tanker (src/data/cases/eagle-s-2024.ts, plan/research/eagle-s-reconstruction.md).
const EAGLE_S_SHIP: ShipSize = { lengthMetres: 228.6, beamMetres: 32, draughtMetres: null, shipType: 80, antennaFromBowMetres: null };
const MS_PER_MINUTE = 60_000;

type Row = { check: string; expectation: string; measured: string; passed: boolean };

function formatUtc(atMs: number): string {
  return `${new Date(atMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function minutesBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / MS_PER_MINUTE);
}

function strongestAlert(assessment: TrackAssessment): Detection | null {
  if (assessment.kind !== "fits") return null;
  return assessment.detections.find((detection) => detection.level === "alert") ?? null;
}

function describeAssessment(assessment: TrackAssessment): string {
  switch (assessment.kind) {
    case "not-eligible":
      return `not eligible (${assessment.reason})`;
    case "insufficient-data":
      return `insufficient data (${assessment.reason})`;
    case "no-fit":
      return `no fit (${assessment.reportCount} reports)`;
    case "fits":
      return assessment.detections.map((detection) => `${detection.level} ${detection.score}`).join(", ");
    default: {
      const unhandled: never = assessment;
      return unhandled;
    }
  }
}

function toArchiveTrack(): TrackPoint[] {
  return YI_PENG_3_ARCHIVE_ROWS.map((row) => ({ ...row, atMs: Date.parse(row.atUtc) }));
}

/** Yi Peng 3 on its own AIS: the minute-rate archive rows, and the 2-minute speed-only fixes the case file keeps. */
function checkYiPeng3(seabed: SeabedInputs): Row[] {
  const rows: Row[] = [];
  const dragWindow = YI_PENG_3_2024.dragWindow;
  if (!dragWindow) return [{ check: "Yi Peng 3", expectation: "case has a drag window", measured: "none", passed: false }];
  const publishedStartMs = Date.parse(dragWindow.startUtc);
  const publishedEndMs = Date.parse(dragWindow.endUtc);
  const archiveTrack = toArchiveTrack();
  const firstReportMs = archiveTrack[0]?.atMs ?? Number.NaN;
  const archive = assessTrack({ track: archiveTrack, cables: seabed.cables, depthAt: seabed.depthAt, ship: YI_PENG_3_SHIP });
  const archiveAlert = strongestAlert(archive);
  rows.push({
    check: "Yi Peng 3, DMA archive, 1 report a minute",
    expectation: "alert over the recorded drag",
    measured: archiveAlert ? `alert ${archiveAlert.score}, ${formatUtc(archiveAlert.startMs)} to ${formatUtc(archiveAlert.endMs)}, rules: ${archiveAlert.evidence.map((item) => item.rule).join(", ")}` : describeAssessment(archive),
    passed: archiveAlert !== null && archiveAlert.startMs < publishedEndMs,
  });
  rows.push({
    check: "Yi Peng 3, drag start",
    expectation: `within ${START_TOLERANCE_MS / MS_PER_MINUTE} min of the first archive report (${formatUtc(firstReportMs)})`,
    measured: archiveAlert
      ? `${minutesBetween(firstReportMs, archiveAlert.startMs)} min after the first report; the published start (${formatUtc(publishedStartMs)}) is ${minutesBetween(publishedStartMs, firstReportMs)} min before any AIS survives, so it cannot be tested`
      : "no alert",
    passed: archiveAlert !== null && archiveAlert.startMs - firstReportMs <= START_TOLERANCE_MS,
  });
  rows.push({
    check: "Yi Peng 3, drag end",
    expectation: `within ${END_TOLERANCE_MS / MS_PER_MINUTE} min of the published end (${formatUtc(publishedEndMs)})`,
    measured: archiveAlert ? `${minutesBetween(publishedEndMs, archiveAlert.endMs)} min (${formatUtc(archiveAlert.endMs)})` : "no alert",
    passed: archiveAlert !== null && Math.abs(archiveAlert.endMs - publishedEndMs) <= END_TOLERANCE_MS,
  });
  // The live schedule sees only the trailing 6 hours at each 5-minute tick, and no report after the tick.
  let firstAlertTickMs: number | null = null;
  for (let tickMs = firstReportMs + DETECTION_INTERVAL_MS; tickMs <= (archiveTrack[archiveTrack.length - 1]?.atMs ?? 0) + DETECTION_INTERVAL_MS; tickMs += DETECTION_INTERVAL_MS) {
    const visible = archiveTrack.filter((point) => point.atMs <= tickMs && point.atMs > tickMs - DETECTION_LOOKBACK_MS);
    if (strongestAlert(assessTrack({ track: visible, cables: seabed.cables, depthAt: seabed.depthAt, ship: YI_PENG_3_SHIP }))) {
      firstAlertTickMs = tickMs;
      break;
    }
  }
  rows.push({
    check: "Yi Peng 3, live schedule replay",
    expectation: `first alert within ${LIVE_LATENCY_LIMIT_MS / MS_PER_MINUTE} min of the published end`,
    measured:
      firstAlertTickMs === null
        ? "never alerted"
        : `first alert at ${formatUtc(firstAlertTickMs)}, ${minutesBetween(publishedEndMs, firstAlertTickMs)} min after the published end (the evidence is the faster passage after the stop)`,
    passed: firstAlertTickMs !== null && firstAlertTickMs - publishedEndMs <= LIVE_LATENCY_LIMIT_MS,
  });
  const caseFixes: TrackPoint[] = (YI_PENG_3_2024.recordedTrack?.fixes ?? []).map((fix) => ({
    atMs: Date.parse(fix.atUtc),
    longitude: fix.longitude,
    latitude: fix.latitude,
    speedKnots: fix.speedKnots,
    courseDegrees: null,
    headingDegrees: null,
    navigationStatus: null,
  }));
  const sparse = assessTrack({ track: caseFixes, cables: seabed.cables, depthAt: seabed.depthAt, ship: YI_PENG_3_SHIP });
  const sparseAlert = strongestAlert(sparse);
  rows.push({
    check: `Yi Peng 3, case file (${caseFixes.length} fixes, speed only)`,
    expectation: `alert, end within ${END_TOLERANCE_MS / MS_PER_MINUTE} min of the published end`,
    measured: sparseAlert ? `alert ${sparseAlert.score}, ends ${minutesBetween(publishedEndMs, sparseAlert.endMs)} min from the published end` : describeAssessment(sparse),
    passed: sparseAlert !== null && Math.abs(sparseAlert.endMs - publishedEndMs) <= END_TOLERANCE_MS,
  });
  return rows;
}

/**
 * Eagle S has no surviving AIS: the case places 3 positions from statements, on the cables at the fault times by
 * construction. Run as a track, it can only test that the detector reports the gap instead of a verdict; it cannot
 * test detection, timing or crossings, because the positions were derived from the very facts a test would compare.
 */
function checkEagleS(seabed: SeabedInputs): Row {
  const placed: TrackPoint[] = EAGLE_S_2024.track.map((position) => ({
    atMs: Date.parse(position.atUtc),
    longitude: position.longitude,
    latitude: position.latitude,
    speedKnots: null,
    courseDegrees: null,
    headingDegrees: null,
    navigationStatus: null,
  }));
  const assessment = assessTrack({ track: placed, cables: seabed.cables, depthAt: seabed.depthAt, ship: EAGLE_S_SHIP });
  return {
    check: `Eagle S, reconstruction (${placed.length} placed positions)`,
    expectation: "insufficient data, shown as a gap, never a verdict",
    measured: `${describeAssessment(assessment)}; the placed positions sit on the cables at the fault times by construction, so detection, timing and crossings cannot be tested`,
    passed: assessment.kind === "insufficient-data",
  };
}

function checkRedTeam(seabed: SeabedInputs): Row[] {
  return buildRedTeamCases().map((redTeamCase) => {
    const assessment = assessTrack({ track: redTeamCase.track, cables: seabed.cables, depthAt: seabed.depthAt, ship: redTeamCase.ship });
    return {
      check: `Red team: ${redTeamCase.name}`,
      expectation: "no alert",
      measured: describeAssessment(assessment),
      passed: strongestAlert(assessment) === null,
    };
  });
}

async function checkRecordedTraffic(): Promise<{ row: Row; details: string[] } | { failure: string }> {
  const credentials = readQueryCredentials();
  if (!credentials.ok) return { failure: credentials.reason };
  const traffic = await fetchRecordedTraffic(credentials.value);
  if (!traffic.ok) return { failure: traffic.reason };
  const gulfSeabed = await loadSeabedInputs("gulf-of-finland");
  if (!gulfSeabed.ok) return { failure: gulfSeabed.reason };
  const replay = replayRecordedTraffic(traffic.value, gulfSeabed.value.depthAt);
  const alertsPerDay = replay.coveredDays > 0 ? replay.alerts.length / replay.coveredDays : Number.POSITIVE_INFINITY;
  const details = replay.alerts.map((alert) => {
    const name = traffic.value.names.get(alert.mmsi) ?? "unnamed";
    return `  alert: MMSI ${alert.mmsi} ${name}, score ${alert.bestScore}, ${formatUtc(alert.startMs)} to ${formatUtc(alert.endMs)}, rules: ${alert.best.detection.evidence.map((item) => item.rule).join(", ")}`;
  });
  return {
    row: {
      check: "Recorded Gulf of Finland traffic, live schedule replay",
      expectation: `under ${MAX_ALERTS_PER_REGION_DAY} alert per region per day`,
      measured: `${replay.alerts.length} alerts in ${(replay.coveredDays * 24).toFixed(1)} h (${alertsPerDay.toFixed(2)} per day), ${replay.watchCount} watch-level, ${replay.shipCount} ships, ${replay.positionCount} positions, ${formatUtc(traffic.value.firstMs)} to ${formatUtc(traffic.value.lastMs)}`,
      passed: alertsPerDay < MAX_ALERTS_PER_REGION_DAY,
    },
    details,
  };
}

/** The table is the script's output, written to stdout as data; log lines go through console with a prefix. */
function printTable(rows: readonly Row[]): void {
  const widths = { check: Math.max(5, ...rows.map((row) => row.check.length)), expectation: Math.max(11, ...rows.map((row) => row.expectation.length)) };
  const lines = [
    `${"Check".padEnd(widths.check)} | ${"Expectation".padEnd(widths.expectation)} | Result | Measured`,
    `${"-".repeat(widths.check)}-|-${"-".repeat(widths.expectation)}-|--------|---------`,
    ...rows.map((row) => `${row.check.padEnd(widths.check)} | ${row.expectation.padEnd(widths.expectation)} | ${row.passed ? "PASS  " : "FAIL  "} | ${row.measured}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<number> {
  const balticSeabed = await loadSeabedInputs("baltic-proper");
  const gulfSeabed = await loadSeabedInputs("gulf-of-finland");
  if (!balticSeabed.ok || !gulfSeabed.ok) {
    console.error(`[main] could not read the seabed files: ${!balticSeabed.ok ? balticSeabed.reason : ""} ${!gulfSeabed.ok ? gulfSeabed.reason : ""}`);
    return 2;
  }
  const recorded = await checkRecordedTraffic();
  if ("failure" in recorded) {
    console.error(`[main] the recorded-traffic check could not run: ${recorded.failure}`);
    return 2;
  }
  const rows = [...checkYiPeng3(balticSeabed.value), checkEagleS(gulfSeabed.value), ...checkRedTeam(gulfSeabed.value), recorded.row];
  printTable(rows);
  if (recorded.details.length > 0) process.stdout.write(`${recorded.details.join("\n")}\n`);
  const failedCount = rows.filter((row) => !row.passed).length;
  console.log(`[main] ${rows.length - failedCount} of ${rows.length} expectations hold`);
  return failedCount === 0 ? 0 : 1;
}

process.exit(await main());
