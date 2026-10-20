"use client";

import { useMemo, useSyncExternalStore } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { readAisMoment, readAisSignal, type AisMoment, type AisSignal, type TimeSpan } from "@/lib/console/ais-signal";
import { formatUtcClock, formatUtcDay } from "@/lib/replay/format-utc";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

const MS_PER_MINUTE = 60_000;
// A silence at least this share of the strip wide carries its label above it ("50 min silent"); a narrower one
// shows only its minutes under it, as on board 23.
const LONG_LABEL_SHARE = 0.12;
// The dashed stub before the axis (CSS px) that says the track was placed from statements before the first report.
const LEAD_IN_PX = 12;
const DASHED_LINE_CLASS = "h-0.5 bg-[repeating-linear-gradient(90deg,var(--color-ink)_0_3px,transparent_3px_6px)]";

function toShare(axis: TimeSpan, atMs: number): number {
  const spanMs = axis.endMs - axis.startMs;
  return spanMs <= 0 ? 0 : Math.min(1, Math.max(0, (atMs - axis.startMs) / spanMs));
}

function toPercent(share: number): string {
  return `${(share * 100).toFixed(3)}%`;
}

/** "18 Nov 06:01" on a case that spans days, "06:01" otherwise. */
function formatMoment(atMs: number, isMultiDay: boolean): string {
  return isMultiDay ? `${formatUtcDay(atMs)} ${formatUtcClock(atMs)}` : formatUtcClock(atMs);
}

/** The replay minute, re-read only when it changes, for the strip's cursor. */
function useReplayMinuteMs(): number {
  const { input, clock } = useConsole();
  const readMinuteMs = () => Math.floor(progressToTimeMs(input, clock.getSnapshot().progress) / MS_PER_MINUTE) * MS_PER_MINUTE;
  return useSyncExternalStore(clock.subscribe, readMinuteMs, readMinuteMs);
}

type StripProps = { signal: AisSignal; axis: TimeSpan; cursorMs: number | null; showsGapLabels: boolean };

/**
 * The strip itself: every AIS report as a 1 px tick on `axis`, each silence as a grey gap with its minutes, and the
 * reconstructed stretches as a dashed line (the reconstruction label rule: placed positions never look recorded).
 * Laid out in percentages, so it lines up with any track of the same axis, the timeline's included.
 */
function AisStrip({ signal, axis, cursorMs, showsGapLabels }: StripProps) {
  const reconstructed = signal.kind === "recorded" ? signal.reconstructed : signal.reconstructed ? [signal.reconstructed] : [];
  const hasLeadIn = reconstructed.some((span) => span.startMs < axis.startMs && span.endMs >= axis.startMs - MS_PER_MINUTE);
  const visibleSpans = reconstructed.filter((span) => span.endMs > axis.startMs && span.startMs < axis.endMs);
  return (
    <div className={`relative ${showsGapLabels ? "pt-4 pb-4" : ""}`} style={{ paddingLeft: hasLeadIn ? LEAD_IN_PX : 0 }} aria-hidden="true">
      <div className="relative h-6">
        {hasLeadIn && <span className={`absolute top-1/2 -translate-y-1/2 ${DASHED_LINE_CLASS}`} style={{ left: -LEAD_IN_PX, width: LEAD_IN_PX - 2 }} />}
        {visibleSpans.map((span) => {
          const startShare = toShare(axis, span.startMs);
          return (
            <span
              key={span.startMs}
              className={`absolute top-1/2 -translate-y-1/2 ${DASHED_LINE_CLASS}`}
              style={{ left: toPercent(startShare), width: toPercent(toShare(axis, span.endMs) - startShare) }}
              data-testid="ais-reconstructed"
              data-state="reconstructed"
            />
          );
        })}
        {signal.kind === "recorded" &&
          signal.gaps.map((gap, index) => {
            const startShare = toShare(axis, gap.startMs);
            const widthShare = toShare(axis, gap.endMs) - startShare;
            const isLongLabel = widthShare >= LONG_LABEL_SHARE;
            return (
              <span
                key={gap.startMs}
                className="absolute inset-y-0 bg-page"
                style={{ left: toPercent(startShare), width: toPercent(widthShare) }}
                title={`No report for ${gap.minutes} min, ${formatUtcClock(gap.startMs)} to ${formatUtcClock(gap.endMs)} UTC`}
                data-testid={`ais-gap-${index}`}
                data-state="gap"
                data-minutes={gap.minutes}
              >
                {showsGapLabels && (
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 text-micro whitespace-nowrap tabular-nums ${isLongLabel ? "-top-4.5 text-ink" : "-bottom-4.5 font-normal text-muted"}`}
                  >
                    {isLongLabel ? `${gap.minutes} min silent` : gap.minutes}
                  </span>
                )}
              </span>
            );
          })}
        {signal.kind === "recorded" &&
          signal.reportTimesMs.map((reportMs) => (
            <span key={reportMs} className="absolute inset-y-1 w-px bg-muted" style={{ left: toPercent(toShare(axis, reportMs)) }} />
          ))}
        {cursorMs !== null && cursorMs >= axis.startMs && cursorMs <= axis.endMs && (
          <span className="absolute -inset-y-1 w-px bg-ink" style={{ left: toPercent(toShare(axis, cursorMs)) }} data-testid="ais-cursor" />
        )}
      </div>
    </div>
  );
}

function describeSignal(signal: AisSignal, isMultiDay: boolean): string {
  if (signal.kind === "no-ais") return "No AIS report for this ship: every position is placed from statements.";
  const gaps = signal.gaps.map((gap) => `${gap.minutes}`).join(", ");
  const first = signal.reportTimesMs[0];
  const last = signal.reportTimesMs[signal.reportTimesMs.length - 1] ?? first;
  return `${signal.reportTimesMs.length} AIS reports from ${formatMoment(first, isMultiDay)} to ${formatMoment(last, isMultiDay)} UTC${gaps ? `, with silences of ${gaps} minutes` : ", with no silence"}${signal.reconstructed.length > 0 ? "; the rest of the track is placed from statements" : ""}.`;
}

/**
 * Ship mode's AIS signal card (style board, board 23): the reports on whole hours around them, the silences and the
 * reconstructed lead-in, what they rest on and the archive they come from. A ship with no AIS says so.
 */
export function AisSignalCard() {
  const { input, consoleCase } = useConsole();
  const signal = useMemo(() => readAisSignal(input.track), [input.track]);
  const cursorMs = useReplayMinuteMs();
  const { isMultiDay, recordedTrack } = consoleCase;
  const axis = signal.kind === "recorded" ? signal.axis : { startMs: input.windowStartMs, endMs: input.windowEndMs };
  const sourceId = recordedTrack?.citations[0]?.sourceId;
  const publisher = consoleCase.sources.find((source) => source.id === sourceId)?.publisher ?? null;
  const reconstructed = signal.kind === "recorded" ? signal.reconstructed : signal.reconstructed ? [signal.reconstructed] : [];
  const reconstructedText = reconstructed.map((span) => `${formatMoment(span.startMs, isMultiDay)} to ${formatMoment(span.endMs, isMultiDay)}`).join(" and ");
  return (
    <section
      aria-label="AIS signal"
      className="flex flex-col gap-2.5 rounded-row bg-card px-5 py-4 shadow-card"
      data-testid="ais-signal"
      data-state={signal.kind}
      data-report-count={signal.kind === "recorded" ? signal.reportTimesMs.length : 0}
      data-gap-minutes={signal.kind === "recorded" ? signal.gaps.map((gap) => gap.minutes).join(",") : ""}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-label">AIS signal</h2>
        <span className="text-caption font-normal text-muted tabular-nums">
          {formatMoment(axis.startMs, isMultiDay)} to {formatUtcClock(axis.endMs)} UTC
        </span>
      </div>
      <div role="img" aria-label={describeSignal(signal, isMultiDay)}>
        <AisStrip signal={signal} axis={axis} cursorMs={cursorMs} showsGapLabels />
      </div>
      <p className="text-caption font-normal text-muted">
        {signal.kind === "recorded" ? (
          <>
            Ticks: {signal.reportTimesMs.length} reports the ship broadcast{publisher ? ` (${publisher})` : ""}. Grey: silences over {Math.round(signal.gapThresholdMs / MS_PER_MINUTE)} min
            {signal.gaps.length === 0 ? ", none here" : ""}.
          </>
        ) : (
          "No AIS report survives for this ship in this case."
        )}
        {reconstructedText && ` Dashed: reconstructed, placed from statements, ${reconstructedText}.`}{" "}
        {recordedTrack && <CitationButtons citations={recordedTrack.citations} />}
      </p>
    </section>
  );
}

function describeMoment(moment: AisMoment): string {
  switch (moment.kind) {
    case "report":
      return `AIS, last report at ${formatUtcClock(moment.atMs)}`;
    case "gap":
      return `no report for ${moment.gap.minutes} min, ${formatUtcClock(moment.gap.startMs)} to ${formatUtcClock(moment.gap.endMs)}`;
    case "reconstructed":
      return "reconstructed position, placed from statements";
    case "no-position":
      return "no position for the ship";
    default: {
      const unhandledMoment: never = moment;
      return unhandledMoment;
    }
  }
}

/**
 * The AIS strip over the timeline while the pointer hovers it (or the scrubber has keyboard focus): the case's whole
 * window, so each tick sits over its moment on the track, and what the signal says at the hovered minute.
 */
export function TimelineSignal({ atMs }: { atMs: number }) {
  const { input, consoleCase } = useConsole();
  const signal = useMemo(() => readAisSignal(input.track), [input.track]);
  const moment = readAisMoment(signal, atMs);
  const axis = { startMs: input.windowStartMs, endMs: input.windowEndMs };
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-full z-(--layer-popover) mb-2 flex flex-col gap-1.5 rounded-field bg-card pt-2 pb-1 shadow-popover"
      data-testid="timeline-ais-hover"
      data-state={moment.kind}
      role="status"
    >
      <p className="px-3 text-caption tabular-nums">
        {formatMoment(atMs, consoleCase.isMultiDay)} UTC <span className="font-normal text-muted">{describeMoment(moment)}</span>
      </p>
      <AisStrip signal={signal} axis={axis} cursorMs={atMs} showsGapLabels={false} />
    </div>
  );
}
