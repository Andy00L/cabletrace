"use client";

import { useSyncExternalStore } from "react";
import { useConsole } from "@/components/console/console-context";
import { findSeriesSample, type SeriesSample } from "@/lib/cases/case-series";
import { formatUtcClock } from "@/lib/replay/format-utc";
import { progressToTimeMs, type ReplayCut } from "@/lib/replay/replay-scene";

// The figures derived at the replay moment (src/lib/cases/case-series.ts), shared by the rail's Ship mode and the
// vessel card so both say the same thing in the same words.

/** `id` names the figure in test hooks (`data-testid` "<prefix>-<id>"). */
export type MomentNumber = { id: string; label: string; value: string; unit: string };

const METRES_PER_KM = 1000;

/** The chart sample at the replay moment; re-renders only when the sample under the cursor changes. Null off the track. */
export function useMomentSample(): SeriesSample | null {
  const { input, series, clock } = useConsole();
  const readSampleIndex = () => (series ? findSeriesSample(series, progressToTimeMs(input, clock.getSnapshot().progress)).index : -1);
  const sampleIndex = useSyncExternalStore(clock.subscribe, readSampleIndex, readSampleIndex);
  return series?.samples[sampleIndex] ?? null;
}

/** The replay's current minute in UTC; re-renders once a minute of replay time, not every frame. */
export function ReplayMinute() {
  const { input, clock } = useConsole();
  const readMinute = () => formatUtcClock(progressToTimeMs(input, clock.getSnapshot().progress));
  return <>{useSyncExternalStore(clock.subscribe, readMinute, readMinute)}</>;
}

export function describeSpeed(sample: SeriesSample): MomentNumber {
  return { id: "speed", label: "Speed", value: sample.speedKnots.toFixed(1), unit: "kn" };
}

/** Three digits, as a course is read at sea: 087. */
export function describeCourse(sample: SeriesSample): MomentNumber {
  return sample.courseDegrees === null
    ? { id: "course", label: "Course", value: "None", unit: "" }
    : { id: "course", label: "Course", value: (Math.round(sample.courseDegrees) % 360).toString().padStart(3, "0"), unit: "°" };
}

export function describeNearestLine(sample: SeriesSample): MomentNumber {
  return sample.nearestLine ? { id: "nearest-line", label: "Nearest line", value: sample.nearestLine.distanceKm.toFixed(1), unit: "km" } : { id: "nearest-line", label: "Nearest line", value: "None", unit: "" };
}

/**
 * The nearest mapped line named as the case names it (a cut cable by its cut label, "C-Lion1"), its distance in
 * metres under a kilometre, where a tenth of a kilometre would round a passage over the cable to nothing.
 */
export function describeNearestLineByName(sample: SeriesSample, cuts: readonly ReplayCut[]): MomentNumber {
  const line = sample.nearestLine;
  if (!line) return { id: "nearest-line", label: "Nearest line", value: "None", unit: "" };
  const label = cuts.find((cut) => cut.cableName === line.name)?.label ?? line.name;
  const metres = line.distanceKm * METRES_PER_KM;
  return metres < METRES_PER_KM ? { id: "nearest-line", label, value: Math.round(metres).toString(), unit: "m" } : { id: "nearest-line", label, value: line.distanceKm.toFixed(1), unit: "km" };
}

/**
 * Figures side by side, each a muted label over a large tabular number and its unit. With `testIdPrefix`, each
 * figure carries `data-testid` "<prefix>-<id>" and `data-state` (`state`, what the figures rest on).
 */
export function NumberGrid({ numbers, testIdPrefix, state }: { numbers: readonly MomentNumber[]; testIdPrefix?: string; state?: string }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {numbers.map((number) => (
        <div key={number.id} className="flex min-w-0 flex-col gap-0.5" data-testid={testIdPrefix ? `${testIdPrefix}-${number.id}` : undefined} data-state={testIdPrefix ? state : undefined}>
          <dt className="truncate text-caption font-normal text-muted">{number.label}</dt>
          <dd className="text-heading tabular-nums">
            {number.value}
            <span className="ml-0.5 text-label text-muted">{number.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
