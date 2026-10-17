"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobeViewer } from "@/lib/globe/globe-viewer";
import { parseLandPolygons } from "@/lib/globe/land-polygons";
import type { Result } from "@/lib/result";
import type { WatchedLine } from "@/lib/globe/watched-line";
import { combineGlobeLines, parseWorldLines, type GlobeLine } from "@/lib/globe/world-lines";

// Built by scripts/globe/build-land.ts and scripts/globe/build-cables.ts.
const LAND_URL = "/globe/land.json";
const CABLES_URL = "/globe/cables.json";

/** Downloads and parses one of the globe's static files; never throws. */
async function fetchJson(url: string): Promise<Result<unknown>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, reason: `${url} answered ${response.status}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, reason: `${url} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type StageState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: string };

type LiveGlobeStageProps = {
  watchedLines: readonly WatchedLine[];
  /** Width of a panel floating over the stage's right edge (CSS px). */
  rightInsetPx: number;
  /** Receives the viewer once it draws, and null when it goes. */
  onViewerChange: (viewer: GlobeViewer | null) => void;
  onShipPick: (mmsi: number | null) => void;
  /** Receives the lines the globe draws: the watched ones first, then the world's once their file has loaded. */
  onLinesChange: (lines: GlobeLine[], worldState: WorldLinesState) => void;
};

export type WorldLinesState = "loading" | "loaded" | "failed";

/** The 3D globe. Ships, time and selection are handed to the viewer by the console; this only builds and frees it. */
export function LiveGlobeStage({ watchedLines, rightInsetPx, onViewerChange, onShipPick, onLinesChange }: LiveGlobeStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GlobeViewer | null>(null);
  const [stageState, setStageState] = useState<StageState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The latest callbacks, so new functions from the parent do not rebuild the globe.
  const callbacksRef = useRef({ onViewerChange, onShipPick, onLinesChange });
  useEffect(() => {
    callbacksRef.current = { onViewerChange, onShipPick, onLinesChange };
  }, [onViewerChange, onShipPick, onLinesChange]);

  // Syncs with three.js, a WebGL scene React does not own: built on mount (and on retry), disposed on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;
    let viewer: GlobeViewer | null = null;

    async function startGlobe(host: HTMLDivElement) {
      // The world's lines download beside the land but never hold the globe back: they are drawn when they land.
      const cablesDownload = fetchJson(CABLES_URL);
      const landDownload = await fetchJson(LAND_URL);
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
        onShipPick: (mmsi) => callbacksRef.current.onShipPick(mmsi),
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (!created.ok) {
        console.error(`[LiveGlobeStage] ${created.reason}`);
        setStageState({ kind: "failed", reason: "This browser cannot draw the 3D globe (WebGL is off or unavailable)." });
        return;
      }
      viewer = created.value;
      viewerRef.current = created.value;
      const watchedOnly = combineGlobeLines([], watchedLines);
      created.value.setLines(watchedOnly);
      callbacksRef.current.onLinesChange(watchedOnly, "loading");
      callbacksRef.current.onViewerChange(created.value);
      setStageState({ kind: "ready" });

      const cablesDownloaded = await cablesDownload;
      const worldLines = cablesDownloaded.ok ? parseWorldLines(cablesDownloaded.value) : cablesDownloaded;
      if (isCancelled) return;
      if (!worldLines.ok) {
        console.error(`[LiveGlobeStage] ${worldLines.reason}`);
        callbacksRef.current.onLinesChange(watchedOnly, "failed");
        return;
      }
      const allLines = combineGlobeLines(worldLines.value.lines, watchedLines);
      created.value.setLines(allLines);
      callbacksRef.current.onLinesChange(allLines, "loaded");
    }

    void startGlobe(container);
    return () => {
      isCancelled = true;
      viewer?.dispose();
      viewerRef.current = null;
      callbacksRef.current.onViewerChange(null);
    };
  }, [watchedLines, attempt]);

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
