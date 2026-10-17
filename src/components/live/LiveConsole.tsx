"use client";

import { useEffect, useState } from "react";
import { FeedCheck, type FeedCheckState } from "@/components/live/FeedCheck";
import { DRAFT_CASE_DAYS, type DraftCasesState } from "@/components/live/LiveDraftCases";
import { LiveDay } from "@/components/live/LiveDay";
import type { DetectionsState } from "@/components/live/LiveRail";
import { fetchRecentDraftCases } from "@/lib/fault-signals/fault-api";
import { createFrameSource } from "@/lib/globe/frame-source";
import { fetchFeedCheck } from "@/lib/health/feed-check-report";
import type { GlobeIncident } from "@/lib/globe/incidents";
import { fetchRecentDetections } from "@/lib/globe/live-api";
import type { WatchedLine } from "@/lib/globe/watched-line";
import type { FrameIndexEntry } from "@/lib/live/frame-layout";

type IndexState = { kind: "loading" } | { kind: "failed" } | { kind: "empty" } | { kind: "ready"; entries: FrameIndexEntry[] };

type LiveConsoleProps = {
  watchedLines: readonly WatchedLine[];
  incidents: readonly GlobeIncident[];
  /** Watched region names by id, for the feed check. */
  regionNames: Readonly<Record<string, string>>;
};

/** Finds the recorded day (the frame index), the detector's results and the feed check, then shows the day on the globe. */
export function LiveConsole({ watchedLines, incidents, regionNames }: LiveConsoleProps) {
  const [frameSource] = useState(createFrameSource);
  const [indexState, setIndexState] = useState<IndexState>({ kind: "loading" });
  const [detectionsState, setDetectionsState] = useState<DetectionsState>({ kind: "loading" });
  const [draftCasesState, setDraftCasesState] = useState<DraftCasesState>({ kind: "loading" });
  const [feedCheckState, setFeedCheckState] = useState<FeedCheckState>({ kind: "loading" });

  // Fetches the frame index, the detections, the drafts and the feed check once, from the CDN route and Supabase,
  // services React does not own.
  useEffect(() => {
    let isCurrent = true;
    void frameSource.loadIndex().then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) {
        console.error(`[LiveConsole] ${outcome.reason}`);
        setIndexState({ kind: "failed" });
        return;
      }
      setIndexState(outcome.value.length === 0 ? { kind: "empty" } : { kind: "ready", entries: outcome.value });
    });
    void fetchRecentDetections().then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) console.error(`[LiveConsole] ${outcome.reason}`);
      setDetectionsState(outcome.ok ? { kind: "loaded", detections: outcome.value } : { kind: "failed" });
    });
    void fetchRecentDraftCases(DRAFT_CASE_DAYS).then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) console.error(`[LiveConsole] ${outcome.reason}`);
      setDraftCasesState(outcome.ok ? { kind: "loaded", drafts: outcome.value } : { kind: "failed" });
    });
    void fetchFeedCheck().then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) console.error(`[LiveConsole] ${outcome.reason}`);
      setFeedCheckState(outcome.ok ? { kind: "loaded", regions: outcome.value } : { kind: "failed" });
    });
    return () => {
      isCurrent = false;
    };
  }, [frameSource]);

  if (indexState.kind === "ready") {
    return <LiveDay entries={indexState.entries} frameSource={frameSource} watchedLines={watchedLines} incidents={incidents} detectionsState={detectionsState} draftCasesState={draftCasesState} feedCheck={<FeedCheck state={feedCheckState} regionNames={regionNames} />} />;
  }
  const message =
    indexState.kind === "loading"
      ? { title: "Loading the recorded day", body: null }
      : indexState.kind === "empty"
        ? { title: "No frame recorded yet", body: "The recorder writes a frame every 10 minutes; the first one has not landed." }
        : { title: "The recorded day could not be loaded", body: "Reload the page to try again." };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6">
      <section className="grid min-h-[320px] flex-1 place-items-center rounded-card bg-soft p-6 shadow-card" data-testid="live-globe" data-state={indexState.kind}>
        <div className="flex w-full max-w-sm flex-col gap-3 rounded-inner bg-card p-5 shadow-card" aria-live="polite">
          <p className="text-label">{message.title}</p>
          {message.body && <p className="text-small text-muted">{message.body}</p>}
          {indexState.kind === "loading" && (
            <>
              <div className="h-2.5 w-full rounded-full bg-soft" />
              <div className="h-2.5 w-3/4 rounded-full bg-soft" />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
