"use client";

import { useState } from "react";
import { ReplayTimeline } from "@/components/replay/ReplayTimeline";
import { SeabedView } from "@/components/replay/SeabedView";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { TimelineEvent } from "@/lib/cases/case-view";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import { CLOSE_UP_SCALE_NOTES, OVERVIEW_SCALE_NOTE } from "@/lib/seabed/scene-scales";
import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

const VIEW_OPTIONS: readonly SegmentOption<SeabedViewName>[] = [
  { value: "overview", label: "Overview" },
  { value: "top", label: "From above" },
  { value: "vessel", label: "Vessel" },
  { value: "closeup", label: "At the cut" },
];

type SeabedDetail = "measured" | "illustrated";
const DETAIL_OPTIONS: readonly SegmentOption<SeabedDetail>[] = [
  { value: "measured", label: "Measured" },
  { value: "illustrated", label: "Illustrated" },
];

// Credit line for the data drawn in the view (docs/UI_DESIGN_SYSTEM.md, Map sources and credits).
const SCENE_CREDITS = "Depth: EMODnet DTM 2024. Land: Copernicus DEM GLO-30. Cables: OpenStreetMap contributors. Pipelines: EMODnet Human Activities.";

const LEGEND_ITEMS = [
  { label: "Track", stroke: "var(--color-ink)", width: 2 },
  { label: "Anchor drag", stroke: "var(--color-alarm)", width: 3 },
  { label: "Cable", stroke: "var(--color-cable)", width: 2.5 },
  { label: "Pipeline", stroke: "var(--color-pipeline)", width: 3 },
] as const;

type ReplayStageProps = {
  input: ReplaySceneInput;
  events: readonly TimelineEvent[];
  clock: ReplayClock;
  localTime: { place: string; timeZone: string };
};

/** The replay card: the 3D seabed with its view switch and legend, then the timeline and the scale note. */
export function ReplayStage({ input, events, clock, localTime }: ReplayStageProps) {
  const [view, setView] = useState<SeabedViewName>("overview");
  const [detail, setDetail] = useState<SeabedDetail>("illustrated");
  const isCloseUp = view === "closeup";
  const scaleNote = isCloseUp ? CLOSE_UP_SCALE_NOTES[detail] : OVERVIEW_SCALE_NOTE;

  return (
    <section aria-label="Replay" className="flex flex-col rounded-card bg-card p-2 shadow-card" data-testid="case-replay">
      <div className="relative aspect-[4/5] overflow-hidden rounded-inner bg-soft sm:aspect-[16/10]">
        <SeabedView input={input} clock={clock} view={view} isIllustrated={detail === "illustrated"} />
        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-3">
          <div className="pointer-events-auto">
            <SegmentedControl label="View" options={VIEW_OPTIONS} value={view} onChange={setView} testId="view-switch" />
          </div>
          {isCloseUp && (
            <div className="pointer-events-auto">
              <SegmentedControl label="Seabed detail" options={DETAIL_OPTIONS} value={detail} onChange={setDetail} testId="detail-switch" />
            </div>
          )}
        </div>
        <div
          className={`pointer-events-none absolute bottom-4 left-4 hidden flex-wrap gap-x-4 gap-y-1.5 rounded-field bg-card px-3.5 py-2.5 text-micro shadow-row ${
            isCloseUp ? "" : "sm:flex"
          }`}
        >
          {LEGEND_ITEMS.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                <path d="M1 4 H21" stroke={item.stroke} strokeWidth={item.width} strokeLinecap="round" />
              </svg>
              {item.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="var(--color-card)" stroke="var(--color-alarm)" strokeWidth="2" />
              <circle cx="7" cy="7" r="2" fill="var(--color-alarm)" />
            </svg>
            Cut
          </span>
        </div>
      </div>
      <ReplayTimeline input={input} events={events} clock={clock} localTime={localTime} />
      <p className="px-5 pt-3 pb-4 text-caption font-normal text-muted" data-testid="scale-note">
        {scaleNote} {SCENE_CREDITS}
      </p>
    </section>
  );
}
