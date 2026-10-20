"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobePick, GlobeView, GlobeViewer } from "@/lib/globe/globe-viewer";
import { parseLandPolygons } from "@/lib/globe/land-polygons";
import { fetchStaticJson } from "@/lib/globe/static-file";
import type { Result } from "@/lib/result";
import type { WatchedLine } from "@/lib/globe/watched-line";
import { combineGlobeLines, parseWorldLines, type GlobeLine } from "@/lib/globe/world-lines";

// Built by scripts/globe/build-land.ts and scripts/globe/build-cables.ts.
const LAND_URL = "/globe/land.json";
const CABLES_URL = "/globe/cables.json";

type StageState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: string };

type LiveGlobeStageProps = {
  watchedLines: readonly WatchedLine[];
  /** Width of a panel floating over the stage's right edge (CSS px). */
  rightInsetPx: number;
  /** Receives the viewer once it draws, and null when it goes. */
  onViewerChange: (viewer: GlobeViewer | null) => void;
  onPick: (pick: GlobePick) => void;
  /** Receives the camera's tier and centre after every frame it moved in. */
  onViewChange: (view: GlobeView) => void;
  /** Receives the lines the globe draws: the watched ones first, then the world's once their file has loaded. */
  onLinesChange: (lines: GlobeLine[], worldState: WorldLinesState) => void;
};

export type WorldLinesState = "loading" | "loaded" | "failed";

/** The 3D globe. Ships, time and selection are handed to the viewer by the console; this only builds and frees it. */
export function LiveGlobeStage({ watchedLines, rightInsetPx, onViewerChange, onPick, onViewChange, onLinesChange }: LiveGlobeStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GlobeViewer | null>(null);
  const [stageState, setStageState] = useState<StageState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The world's lines for the current globe: requested once it shows, laid out once (effect below).
  const cablesDownloadRef = useRef<{ viewer: GlobeViewer; download: Promise<Result<unknown>> | null; isApplied: boolean } | null>(null);
  // The latest callbacks, so new functions from the parent do not rebuild the globe.
  const callbacksRef = useRef({ onViewerChange, onPick, onViewChange, onLinesChange });
  useEffect(() => {
    callbacksRef.current = { onViewerChange, onPick, onViewChange, onLinesChange };
  }, [onViewerChange, onPick, onViewChange, onLinesChange]);

  // Syncs with three.js, a WebGL scene React does not own: built on mount (and on retry), disposed on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;
    let viewer: GlobeViewer | null = null;

    async function startGlobe(host: HTMLDivElement) {
      const landDownload = await fetchStaticJson(LAND_URL);
      if (!landDownload.ok) {
        console.error(`[LiveGlobeStage] ${landDownload.reason}`);
        if (!isCancelled) setStageState({ kind: "failed", reason: "The land outline could not be loaded." });
        return;
      }
      const land = parseLandPolygons(landDownload.value);
      const viewerModule = await import("@/lib/globe/globe-viewer");
      if (isCancelled) return;
      if (!land.ok) {
        console.error(`[LiveGlobeStage] ${land.reason}`);
        setStageState({ kind: "failed", reason: "The land outline could not be read." });
        return;
      }
      const created = viewerModule.createGlobeViewer({
        container: host,
        land: land.value,
        onPick: (pick) => callbacksRef.current.onPick(pick),
        onViewChange: (view) => callbacksRef.current.onViewChange(view),
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (!created.ok) {
        console.error(`[LiveGlobeStage] ${created.reason}`);
        setStageState({ kind: "failed", reason: "This browser cannot draw the 3D globe (WebGL is off or unavailable)." });
        return;
      }
      viewer = created.value;
      viewerRef.current = created.value;
      callbacksRef.current.onViewerChange(created.value);
      cablesDownloadRef.current = { viewer: created.value, download: null, isApplied: false };
      setStageState({ kind: "ready" });
    }

    void startGlobe(container);
    return () => {
      isCancelled = true;
      viewer?.dispose();
      viewerRef.current = null;
      callbacksRef.current.onViewerChange(null);
    };
  }, [watchedLines, attempt]);

  // Draws the lines once the ready globe has been committed, the watched ones at once and the world's when their file
  // lands: the file (567 KB of JSON), building 4,000 lines and compiling the line shaders take several hundred ms of
  // main thread on a software renderer (no parallel shader compile there), which must not hold back the globe showing.
  // Syncs the three.js scene React does not own.
  useEffect(() => {
    const pending = cablesDownloadRef.current;
    if (stageState.kind !== "ready" || !pending || pending.isApplied) return;
    let isCurrent = true;
    if (pending.download === null) {
      const watchedOnly = combineGlobeLines([], watchedLines);
      pending.viewer.setLines(watchedOnly);
      callbacksRef.current.onLinesChange(watchedOnly, "loading");
      pending.download = fetchStaticJson(CABLES_URL);
    }
    void pending.download.then((downloaded) => {
      if (!isCurrent || pending.isApplied || viewerRef.current !== pending.viewer) return;
      pending.isApplied = true;
      const worldLines = downloaded.ok ? parseWorldLines(downloaded.value) : downloaded;
      if (!worldLines.ok) {
        console.error(`[LiveGlobeStage] ${worldLines.reason}`);
        callbacksRef.current.onLinesChange(combineGlobeLines([], watchedLines), "failed");
        return;
      }
      const allLines = combineGlobeLines(worldLines.value.lines, watchedLines);
      pending.viewer.setLines(allLines);
      callbacksRef.current.onLinesChange(allLines, "loaded");
    });
    return () => {
      isCurrent = false;
    };
  }, [stageState.kind, watchedLines]);

  useEffect(() => {
    viewerRef.current?.setRightInset(rightInsetPx);
  }, [rightInsetPx, stageState]);

  return (
    <div className="absolute inset-0" data-testid="live-globe-view" data-state={stageState.kind}>
      <div ref={containerRef} className="absolute inset-0" role="img" aria-label="3D globe with the ships the feeds heard and the watched cables" />
      {stageState.kind === "loading" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-full max-w-xs flex-col gap-3 rounded-inner bg-card p-5 shadow-card" aria-live="polite">
            <p className="text-label">Loading the globe</p>
            <div className="h-2.5 w-full rounded-full bg-soft" />
            <div className="h-2.5 w-3/4 rounded-full bg-soft" />
          </div>
        </div>
      )}
      {stageState.kind === "failed" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-inner bg-card p-5 shadow-card" role="alert">
            <p className="text-label">The globe did not load</p>
            <p className="text-small text-muted">{stageState.reason}</p>
            <button
              type="button"
              onClick={() => {
                setStageState({ kind: "loading" });
                setAttempt((previousAttempt) => previousAttempt + 1);
              }}
              className="h-10 self-start rounded-full bg-ink px-5 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.97]"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
