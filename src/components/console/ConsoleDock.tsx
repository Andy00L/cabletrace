"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AsciiPicture } from "@/components/ascii/AsciiPicture";
import { useConsole } from "@/components/console/console-context";
import { ReplayTimeline, ReplayTransport } from "@/components/replay/ReplayTimeline";
import { findSeriesSample, type CaseSeries, type SeriesSample } from "@/lib/cases/case-series";
import { progressToTimeMs, timeMsToProgress } from "@/lib/replay/replay-scene";

// The AIS strip over the timeline loads on the first hover, outside the route's chunks (see VesselInspector in
// ConsoleRail). It floats over the stage, so nothing waits for it.
const TimelineSignal = dynamic(() => import("@/components/console/AisSignalStrip").then((module) => module.TimelineSignal), { ssr: false, loading: () => null });
const MS_PER_MINUTE = 60_000;

// Each chart draws into a 1000 by 64 unit box stretched to its width; lines keep their pixel width.
const CHART_UNITS_WIDE = 1000;
const CHART_UNITS_TALL = 64;
const CHART_PADDING_UNITS = 4;

// The dock's night sea (docs/UI_DESIGN_SYSTEM.md, ASCII layer and Console, Dock and status): the sea under the Albany
// in Dudley's night painting, as fractions of the picture (left, top, width, height), about as wide for its height as
// the dock, drawn in the hatch style Andy picked for the dock (engraved horizontal strokes on 4 px lines, each stroke
// as thick as its patch is bright, held still). Every stroke goes 65% of the way to slate: strokes cover about half
// the band, three times what glyphs cover, and at the glyphs' 45% the brightest stood at 3.1:1 on slate, louder than
// the texture it is meant to be (measured in the Console section of the design doc).
const DOCK_SEA_PICTURE = "/landing/archive/albany-at-night-1200.webp";
const DOCK_SEA_REGION = [0, 0.74, 1, 0.26] as const;
const DOCK_SEA_CELL_PX = 4;
const DOCK_SEA_TONE_SHARE = 0.65;
// Every line of text in the dock carries a slate halo, as the scene's labels carry a vellum one (map-label-halo): the
// strokes right around a letter fall back to slate, so the dock's small mist text keeps close to its 6.0:1 on slate
// (measured in the Console section of the design doc). It inherits; the AIS strip's vellum card over the timeline
// turns it off.
const SLATE_HALO_CLASS = "[text-shadow:0_0_2px_var(--color-slate),0_0_4px_var(--color-slate),0_0_4px_var(--color-slate),0_0_8px_var(--color-slate)]";

type ChartKind = "speed" | "distance" | "depth";
/** What a chart sits on: the dock's slate band, or a vellum card (the rail's Ship mode under 1024 px). */
export type ChartSurface = "slate" | "card";

const CHART_LABELS: Record<ChartKind, { title: string; unit: string }> = {
  speed: { title: "Speed over ground", unit: "kn" },
  distance: { title: "Nearest cable or pipeline", unit: "km" },
  depth: { title: "Water under the ship", unit: "m" },
};
// Each chart's line as a CSS colour, per surface. On card the data tokens as they are; on slate each line keeps at
// least 3:1 against slate (WCAG graphics): page for speed (11.5:1), mist for depth (6.0:1), and the cable blue
// lifted a quarter toward page, #608BD9, 4.1:1 where the cable token itself is 2.8:1 (.scratch/ratios.ts, 22 Oct 2026).
const CHART_LINE_COLOURS: Record<ChartSurface, Record<ChartKind, string>> = {
  card: { speed: "var(--color-ink)", distance: "var(--color-cable)", depth: "var(--color-muted)" },
  slate: { speed: "var(--color-page)", distance: "color-mix(in srgb, var(--color-cable) 75%, var(--color-page))", depth: "var(--color-mist)" },
};
// The rest of a chart's tones per surface: the unit and axis text, the cursor, the value ring's fill, the depth area
// and the drag window's alarm band (a share of alarm: slate needs more of it than vellum to show).
const CHART_TONES: Record<ChartSurface, { unitClass: string; axisClass: string; noteClass: string; cursorClass: string; ringFillClass: string; areaClass: string; areaOpacity: number; dragOpacity: number }> = {
  card: { unitClass: "text-muted", axisClass: "text-faint", noteClass: "text-muted", cursorClass: "bg-ink", ringFillClass: "bg-card", areaClass: "fill-depth-40", areaOpacity: 1, dragOpacity: 0.05 },
  slate: { unitClass: "text-mist", axisClass: "text-mist", noteClass: "text-mist", cursorClass: "bg-page", ringFillClass: "bg-slate", areaClass: "fill-mist", areaOpacity: 0.16, dragOpacity: 0.1 },
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

function Chart({ kind, series, sample, surface }: { kind: ChartKind; series: CaseSeries; sample: SeriesSample | null; surface: ChartSurface }) {
  const { input } = useConsole();
  const geometry = useMemo(() => buildGeometry(kind, series), [kind, series]);
  const chart = CHART_LABELS[kind];
  const lineColour = CHART_LINE_COLOURS[surface][kind];
  const tones = CHART_TONES[surface];
  const value = sample ? readValue(kind, sample) : null;
  const dragWindow = input.dragWindow;
  const cursorShare = sample ? timeMsToProgress(input, sample.atMs) : null;
  const valueShare = value === null ? null : kind === "depth" ? value / geometry.axisMax : 1 - value / geometry.axisMax;
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid={`chart-${kind}`}>
      <figcaption className="flex items-baseline gap-2">
        <span className="text-caption">{chart.title}</span>
        <span className={`text-caption font-normal ${tones.unitClass}`}>{chart.unit}</span>
        <span className="ml-auto text-label tabular-nums">{value !== null ? `${formatValue(kind, value)} ${chart.unit}` : sample ? "Not mapped" : "No position"}</span>
      </figcaption>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-1.5">
        <div className={`flex flex-col justify-between text-micro font-normal tabular-nums ${tones.axisClass}`} aria-hidden="true">
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
                fillOpacity={tones.dragOpacity}
              />
            )}
            {geometry.runs.map((run, index) => (
              <g key={index}>
                {run.area && <path d={run.area} className={tones.areaClass} fillOpacity={tones.areaOpacity} />}
                <path
                  d={run.path}
                  fill="none"
                  style={{ stroke: lineColour }}
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
            <span className={`absolute inset-y-0 w-px ${tones.cursorClass}`} style={{ left: `${(cursorShare * 100).toFixed(2)}%` }} aria-hidden="true">
              {valueShare !== null && (
                <span
                  className={`absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${tones.ringFillClass}`}
                  style={{ top: `${(valueShare * 100).toFixed(2)}%`, borderColor: lineColour }}
                />
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
 * 1024 px, where the dock keeps only the transport and the timeline). `surface` picks the tones for the slate dock
 * or a vellum card. They re-render when the cursor moves to another sample.
 */
export function CaseCharts({ series, isStacked, surface }: { series: CaseSeries; isStacked: boolean; surface: ChartSurface }) {
  const { input, clock } = useConsole();
  const readSampleIndex = () => findSeriesSample(series, progressToTimeMs(input, clock.getSnapshot().progress)).index;
  const sampleIndex = useSyncExternalStore(clock.subscribe, readSampleIndex, readSampleIndex);
  const sample = series.samples[sampleIndex] ?? null;
  return (
    <div className="flex flex-col gap-1">
      <div className={isStacked ? "flex flex-col gap-4" : "flex gap-7"}>
        <Chart kind="speed" series={series} sample={sample} surface={surface} />
        <Chart kind="distance" series={series} sample={sample} surface={surface} />
        <Chart kind="depth" series={series} sample={sample} surface={surface} />
      </div>
      <p className={`text-micro font-normal ${CHART_TONES[surface].noteClass}`}>{describeBasis(series)}. Depth: the 3D view&apos;s seabed grid under the drawn track.</p>
    </div>
  );
}

/**
 * The timeline with the AIS signal strip over it while the pointer hovers it, or while the scrubber has keyboard
 * focus (then at the replay minute). Touch has no hover, so a finger on the scrubber only scrubs.
 */
function TimelineWithSignal() {
  const { input, consoleCase, clock, openLayer } = useConsole();
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [isScrubberFocused, setIsScrubberFocused] = useState(false);
  const readFocusMs = () => (isScrubberFocused ? Math.floor(progressToTimeMs(input, clock.getSnapshot().progress) / MS_PER_MINUTE) * MS_PER_MINUTE : null);
  const focusMs = useSyncExternalStore(clock.subscribe, readFocusMs, readFocusMs);
  const shownMs = hoverMs ?? focusMs;
  return (
    <div
      className="relative min-w-0 lg:flex-1"
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const rect = event.currentTarget.getBoundingClientRect();
        const share = rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
        // Whole minutes, so moving within a minute does not redraw the strip.
        setHoverMs(Math.floor(progressToTimeMs(input, share) / MS_PER_MINUTE) * MS_PER_MINUTE);
      }}
      onPointerLeave={() => setHoverMs(null)}
      onFocus={(event) => setIsScrubberFocused(event.target.matches("input[type='range']:focus-visible"))}
      onBlur={() => setIsScrubberFocused(false)}
    >
      <ReplayTimeline input={input} events={consoleCase.events} clock={clock} onCutSelect={(cutIndex, opener) => openLayer({ kind: "cut", cutIndex }, opener)} />
      {shownMs !== null && <TimelineSignal atMs={shownMs} />}
    </div>
  );
}

/**
 * The dock under the stage, a slate band (the night sea, Andy's style board of 22 Oct 2026): transport and timeline,
 * and on wide screens the three charts, over a faint engraved redraw of the painting's sea. The canvas draws once per
 * size change and holds still (hatch never shimmers), so it costs nothing per frame (AsciiPicture). It is not clipped by
 * the section itself, so the AIS strip can float out over the stage; its own wrapper clips it to the corners, and the
 * content rows are positioned so they paint over it.
 */
export function ConsoleDock({ showCharts }: { showCharts: boolean }) {
  const { input, consoleCase, clock, series } = useConsole();
  return (
    <section aria-label="Replay controls" className={`relative flex flex-none flex-col gap-3.5 rounded-card bg-slate px-5 pt-4 pb-3.5 text-page shadow-card ${SLATE_HALO_CLASS}`} data-console-dock>
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-card" aria-hidden="true">
        <AsciiPicture src={DOCK_SEA_PICTURE} region={DOCK_SEA_REGION} cellPx={DOCK_SEA_CELL_PX} style="hatch" tone="slate" toneShare={DOCK_SEA_TONE_SHARE} className="size-full" />
      </div>
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
        <ReplayTransport input={input} clock={clock} localTime={consoleCase.localTime} />
        <TimelineWithSignal />
      </div>
      {showCharts && series && (
        <div className="relative">
          <CaseCharts series={series} isStacked={false} surface="slate" />
        </div>
      )}
    </section>
  );
}
