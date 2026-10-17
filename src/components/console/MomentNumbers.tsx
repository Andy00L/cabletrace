"use client";

import { useSyncExternalStore } from "react";
import { useConsole } from "@/components/console/console-context";
import { findSeriesSample, type SeriesSample } from "@/lib/cases/case-series";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

// The figures derived at the replay moment (src/lib/cases/case-series.ts), shared by the rail's Ship mode and the
// vessel card so both say the same thing in the same words.

export type MomentNumber = { label: string; value: string; unit: string };

/** The chart sample at the replay moment; re-renders only when the sample under the cursor changes. Null off the track. */
export function useMomentSample(): SeriesSample | null {
  const { input, series, clock } = useConsole();
  const readSampleIndex = () => (series ? findSeriesSample(series, progressToTimeMs(input, clock.getSnapshot().progress)).index : -1);
  const sampleIndex = useSyncExternalStore(clock.subscribe, readSampleIndex, readSampleIndex);
  return series?.samples[sampleIndex] ?? null;
}

export function describeSpeed(sample: SeriesSample): MomentNumber {
  return { label: "Speed", value: sample.speedKnots.toFixed(1), unit: "kn" };
}

/** Three digits, as a course is read at sea: 087. */
export function describeCourse(sample: SeriesSample): MomentNumber {
  return sample.courseDegrees === null
    ? { label: "Course", value: "None", unit: "" }
    : { label: "Course", value: (Math.round(sample.courseDegrees) % 360).toString().padStart(3, "0"), unit: "°" };
}

export function describeNearestLine(sample: SeriesSample): MomentNumber {
  return sample.nearestLine ? { label: "Nearest line", value: sample.nearestLine.distanceKm.toFixed(1), unit: "km" } : { label: "Nearest line", value: "None", unit: "" };
}

export function describeWaterUnder(sample: SeriesSample): MomentNumber {
  return sample.depthMetres === null ? { label: "Water under", value: "None", unit: "" } : { label: "Water under", value: Math.round(sample.depthMetres).toString(), unit: "m" };
}

/** Figures side by side, each a muted label over a large tabular number and its unit. */
export function NumberGrid({ numbers }: { numbers: readonly MomentNumber[] }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {numbers.map((number) => (
        <div key={number.label} className="flex flex-col gap-0.5">
          <dt className="text-caption font-normal text-muted">{number.label}</dt>
          <dd className="text-heading tabular-nums">
            {number.value}
            <span className="ml-0.5 text-label text-muted">{number.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
