import type { TimedPosition } from "@/lib/replay/replay-scene";

// The AIS signal strip (style board, board 23): every report the ship broadcast as a tick, the silences between
// them drawn as gaps with their length, and the stretches placed from statements drawn apart from the recorded
// ones. Read from the replay track itself, the one the 3D view and the timeline draw: a position with a recorded
// speed is an AIS report, one without was placed from statements (src/lib/cases/case-file.ts, toReplaySceneInput).

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
// The archive extracts keep the first report of every 2 minutes (Danish Maritime Authority) or 5 minutes (Norwegian
// Coastal Administration): sourceRef the headers of src/data/cases/*-ais.ts. A silence is longer than 2.5 of those
// steps and never shorter than 5 minutes, the length those headers already call a gap ("Gaps over 5 minutes").
const MIN_GAP_MS = 5 * MS_PER_MINUTE;
const GAP_TO_SAMPLING_STEP = 2.5;

export type TimeSpan = { startMs: number; endMs: number };

/** A silence between two AIS reports, with its length rounded to whole minutes. */
export type AisGap = TimeSpan & { minutes: number };

export type AisSignal =
  /** No report survives: every position was placed from statements (null when the case has no position at all). */
  | { kind: "no-ais"; reconstructed: TimeSpan | null }
  | {
      kind: "recorded";
      /** Every AIS report, sorted. */
      reportTimesMs: [number, ...number[]];
      gaps: AisGap[];
      /** The silence a gap has to exceed, from the archive's sampling step. */
      gapThresholdMs: number;
      /** Stretches with a placed position at one end at least: reconstructed, never recorded. */
      reconstructed: TimeSpan[];
      /** Whole hours around the reports: the strip's axis in Ship mode. */
      axis: TimeSpan;
    };

/** What the signal says at one moment, for the timeline's hover readout. */
export type AisMoment =
  | { kind: "report"; atMs: number }
  | { kind: "gap"; gap: AisGap }
  | { kind: "reconstructed"; span: TimeSpan }
  | { kind: "no-position" };

function isRecorded(position: TimedPosition): boolean {
  return position.recordedSpeedKnots !== null;
}

function readMedian(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** The stretches between consecutive positions where either end was placed, joined where they touch. */
function findReconstructedSpans(track: readonly TimedPosition[]): TimeSpan[] {
  const spans: TimeSpan[] = [];
  track.forEach((position, index) => {
    const previous = track[index - 1];
    if (!previous || (isRecorded(previous) && isRecorded(position))) return;
    const lastSpan = spans.at(-1);
    if (lastSpan && lastSpan.endMs === previous.atMs) lastSpan.endMs = position.atMs;
    else spans.push({ startMs: previous.atMs, endMs: position.atMs });
  });
  return spans;
}

/** Reads the signal strip from the replay track (sorted by time, as ReplaySceneInput keeps it). */
export function readAisSignal(track: readonly TimedPosition[]): AisSignal {
  const [firstReport, ...laterReports] = track.filter(isRecorded).map((position) => position.atMs);
  if (firstReport === undefined) {
    const first = track[0];
    const last = track.at(-1);
    return { kind: "no-ais", reconstructed: first && last ? { startMs: first.atMs, endMs: last.atMs } : null };
  }
  const reportTimesMs: [number, ...number[]] = [firstReport, ...laterReports];
  const intervals = laterReports.map((atMs, index) => atMs - (reportTimesMs[index] ?? atMs));
  const gapThresholdMs = Math.max(MIN_GAP_MS, GAP_TO_SAMPLING_STEP * readMedian(intervals));
  const gaps = laterReports.flatMap((endMs, index): AisGap[] => {
    const startMs = reportTimesMs[index] ?? endMs;
    return endMs - startMs > gapThresholdMs ? [{ startMs, endMs, minutes: Math.round((endMs - startMs) / MS_PER_MINUTE) }] : [];
  });
  const lastReport = reportTimesMs[reportTimesMs.length - 1] ?? firstReport;
  return {
    kind: "recorded",
    reportTimesMs,
    gaps,
    gapThresholdMs,
    reconstructed: findReconstructedSpans(track),
    axis: { startMs: Math.floor(firstReport / MS_PER_HOUR) * MS_PER_HOUR, endMs: Math.max(Math.ceil(lastReport / MS_PER_HOUR), Math.floor(firstReport / MS_PER_HOUR) + 1) * MS_PER_HOUR },
  };
}

function contains(span: TimeSpan, atMs: number): boolean {
  return atMs >= span.startMs && atMs <= span.endMs;
}

/**
 * The signal at a moment: inside a reconstructed stretch, inside a silence, or the last report heard (the one the
 * 3D ship sails on from). Outside the track there is no position to speak of.
 */
export function readAisMoment(signal: AisSignal, atMs: number): AisMoment {
  switch (signal.kind) {
    case "no-ais":
      return signal.reconstructed && contains(signal.reconstructed, atMs) ? { kind: "reconstructed", span: signal.reconstructed } : { kind: "no-position" };
    case "recorded": {
      const span = signal.reconstructed.find((candidate) => contains(candidate, atMs));
      if (span) return { kind: "reconstructed", span };
      const gap = signal.gaps.find((candidate) => atMs > candidate.startMs && atMs < candidate.endMs);
      if (gap) return { kind: "gap", gap };
      const lastHeard = signal.reportTimesMs.findLast((reportMs) => reportMs <= atMs);
      const lastReport = signal.reportTimesMs[signal.reportTimesMs.length - 1] ?? signal.reportTimesMs[0];
      return lastHeard === undefined || atMs > lastReport ? { kind: "no-position" } : { kind: "report", atMs: lastHeard };
    }
    default: {
      const unhandledSignal: never = signal;
      return unhandledSignal;
    }
  }
}
