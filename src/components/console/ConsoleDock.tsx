"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useConsole } from "@/components/console/console-context";
import { ReplayTimeline, ReplayTransport } from "@/components/replay/ReplayTimeline";
import { findSeriesSample, type CaseSeries, type SeriesSample } from "@/lib/cases/case-series";
import { progressToTimeMs, timeMsToProgress } from "@/lib/replay/replay-scene";

// Each chart draws into a 1000 by 64 unit box stretched to its width; lines keep their pixel width.
const CHART_UNITS_WIDE = 1000;
const CHART_UNITS_TALL = 64;
const CHART_PADDING_UNITS = 4;

type ChartKind = "speed" | "distance" | "depth";

const CHARTS: Record<ChartKind, { title: string; unit: string; strokeClass: string; markerClass: string }> = {
  speed: { title: "Speed over ground", unit: "kn", strokeClass: "stroke-ink", markerClass: "border-ink" },
  distance: { title: "Nearest cable or pipeline", unit: "km", strokeClass: "stroke-cable", markerClass: "border-cable" },
  depth: { title: "Water under the ship", unit: "m", strokeClass: "stroke-muted", markerClass: "border-muted" },
};

function readValue(kind: ChartKind, sample: SeriesSample): number | null {
  switch (kind) {
    case "speed":
      return sample.speedKnots;
    case "distance":
      return sample.nearestLine?.distanceKm ?? null;
    case "depth":
      return sample.depthMetres;
    default: {
      const unhandledKind: never = kind;
      return unhandledKind;
    }
  }
}

function formatValue(kind: ChartKind, value: number): string {
  return kind === "depth" ? `${Math.round(value)}` : value.toFixed(1);
}

/** The highest value on the axis: a round number above the series' maximum. */
function chooseAxisMax(kind: ChartKind, maximum: number): number {
  if (kind === "depth") return Math.max(20, Math.ceil(maximum / 20) * 20);
  if (kind === "speed") return Math.max(8, Math.ceil(maximum / 2) * 2);
  return Math.max(1, Math.ceil(maximum));
}

type ChartGeometry = { axisMax: number; runs: { basis: SeriesSample["basis"]; path: string; area: string }[] };

/** The chart's lines as SVG paths, split where a stretch changes from recorded to interpolated or has no value. */
function buildGeometry(kind: ChartKind, series: CaseSeries): ChartGeometry {
  const values = series.samples.flatMap((sample) => {
    const value = sample ? readValue(kind, sample) : null;
    return value === null ? [] : [value];
  });
  const axisMax = chooseAxisMax(kind, values.length > 0 ? Math.max(...values) : 1);
  const spanMs = series.windowEndMs - series.windowStartMs;
  const toX = (atMs: number) => ((atMs - series.windowStartMs) / spanMs) * CHART_UNITS_WIDE;
  const plotHeight = CHART_UNITS_TALL - 2 * CHART_PADDING_UNITS;
  // Depth grows downward, like a profile of the water column; the other two grow upward.
  const toY = (value: number) => (kind === "depth" ? CHART_PADDING_UNITS + (value / axisMax) * plotHeight : CHART_UNITS_TALL - CHART_PADDING_UNITS - (value / axisMax) * plotHeight);
  const runs: { basis: SeriesSample["basis"]; points: [number, number][] }[] = [];
  let isGap = true;
  series.samples.forEach((sample) => {
    const value = sample ? readValue(kind, sample) : null;
    if (!sample || value === null) {
      isGap = true;
      return;
    }
    const point: [number, number] = [toX(sample.atMs), toY(value)];
    const lastRun = runs[runs.length - 1];
    if (!isGap && lastRun && lastRun.basis === sample.basis) lastRun.points.push(point);
    else runs.push({ basis: sample.basis, points: lastRun && !isGap ? [lastRun.points[lastRun.points.length - 1] ?? point, point] : [point] });
    isGap = false;
  });
  return {
    axisMax,
    runs: runs
      .filter((run) => run.points.length > 1)
      .map((run) => {
        const path = run.points.map(([pointX, pointY], index) => `${index === 0 ? "M" : "L"}${pointX.toFixed(1)} ${pointY.toFixed(1)}`).join("");
        const first = run.points[0];
        const last = run.points[run.points.length - 1];
        const area = kind === "depth" && first && last ? `${path}L${last[0].toFixed(1)} ${CHART_UNITS_TALL}L${first[0].toFixed(1)} ${CHART_UNITS_TALL}Z` : "";
        return { basis: run.basis, path, area };
      }),
  };
}

function describeBasis(series: CaseSeries): string {
  const bases = new Set(series.samples.flatMap((sample) => (sample ? [sample.basis] : [])));
  if (bases.has("recorded") && bases.has("interpolated")) return "Solid between AIS fixes, dashed between placed positions";
  if (bases.has("recorded")) return "From the ship's AIS reports";
  return "Between placed positions: averages on a straight line, never recorded";
}

function Chart({ kind, series, sample }: { kind: ChartKind; series: CaseSeries; sample: SeriesSample | null }) {
  const { input } = useConsole();
  const geometry = useMemo(() => buildGeometry(kind, series), [kind, series]);
  const chart = CHARTS[kind];
  const value = sample ? readValue(kind, sample) : null;
  const dragWindow = input.dragWindow;
  const cursorShare = sample ? timeMsToProgress(input, sample.atMs) : null;
  const valueShare = value === null ? null : kind === "depth" ? value / geometry.axisMax : 1 - value / geometry.axisMax;
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid={`chart-${kind}`}>
      <figcaption className="flex items-baseline gap-2">
        <span className="text-caption">{chart.title}</span>
        <span className="text-caption font-normal text-muted">{chart.unit}</span>
        <span className="ml-auto text-label tabular-nums">{value !== null ? `${formatValue(kind, value)} ${chart.unit}` : sample ? "Not mapped" : "No position"}</span>
      </figcaption>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-1.5">
        <div className="flex flex-col justify-between text-micro font-normal text-faint tabular-nums" aria-hidden="true">
          <span>{kind === "depth" ? 0 : geometry.axisMax}</span>
          <span>{kind === "depth" ? geometry.axisMax : 0}</span>
        </div>
        <div className="relative h-16">
          <svg viewBox={`0 0 ${CHART_UNITS_WIDE} ${CHART_UNITS_TALL}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
            {dragWindow && (
              <rect
                x={timeMsToProgress(input, dragWindow.startMs) * CHART_UNITS_WIDE}
                y={0}
                width={(timeMsToProgress(input, dragWindow.endMs) - timeMsToProgress(input, dragWindow.startMs)) * CHART_UNITS_WIDE}
                height={CHART_UNITS_TALL}
                className="fill-alarm"
                fillOpacity={0.05}
              />
            )}
            {geometry.runs.map((run, index) => (
              <g key={index}>
                {run.area && <path d={run.area} className="fill-depth-40" />}
                <path
                  d={run.path}
                  fill="none"
                  className={chart.strokeClass}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={run.basis === "interpolated" ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
          {cursorShare !== null && (
            <span className="absolute inset-y-0 w-px bg-ink" style={{ left: `${(cursorShare * 100).toFixed(2)}%` }} aria-hidden="true">
              {valueShare !== null && (
                <span className={`absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card ${chart.markerClass}`} style={{ top: `${(valueShare * 100).toFixed(2)}%` }} />
              )}
            </span>
          )}
        </div>
      </div>
    </figure>
  );
}

/**
 * The three charts on the replay's time axis, side by side in the dock or stacked in the rail's Ship mode (under
 * 1024 px, where the dock keeps only the transport and the timeline). They re-render when the cursor moves to
 * another sample.
 */
export function CaseCharts({ series, isStacked }: { series: CaseSeries; isStacked: boolean }) {
  const { input, clock } = useConsole();
  const readSampleIndex = () => findSeriesSample(series, progressToTimeMs(input, clock.getSnapshot().progress)).index;
  const sampleIndex = useSyncExternalStore(clock.subscribe, readSampleIndex, readSampleIndex);
  const sample = series.samples[sampleIndex] ?? null;
  return (
    <div className="flex flex-col gap-1">
      <div className={isStacked ? "flex flex-col gap-4" : "flex gap-7"}>
        <Chart kind="speed" series={series} sample={sample} />
        <Chart kind="distance" series={series} sample={sample} />
        <Chart kind="depth" series={series} sample={sample} />
      </div>
      <p className="text-micro font-normal text-muted">{describeBasis(series)}. Depth: the 3D view&apos;s seabed grid under the drawn track.</p>
    </div>
  );
}

/** The dock under the stage: transport and timeline, and on wide screens the three charts. */
export function ConsoleDock({ showCharts }: { showCharts: boolean }) {
  const { input, consoleCase, clock, series, openLayer } = useConsole();
  return (
    <section aria-label="Replay controls" className="flex flex-none flex-col gap-3.5 rounded-card bg-card px-5 pt-4 pb-3.5 shadow-card" data-console-dock>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
        <ReplayTransport input={input} clock={clock} localTime={consoleCase.localTime} />
        <ReplayTimeline input={input} events={consoleCase.events} clock={clock} onCutSelect={(cutIndex, opener) => openLayer({ kind: "cut", cutIndex }, opener)} />
      </div>
      {showCharts && series && <CaseCharts series={series} isStacked={false} />}
    </section>
  );
}
