"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import { progressToTimeMs, type ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewer, SeabedViewName } from "@/lib/seabed/scene/viewer";
import { loadSeabedData } from "@/lib/seabed/seabed-data";

type ViewerState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: string };

type SeabedViewProps = {
  input: ReplaySceneInput;
  clock: ReplayClock;
  view: SeabedViewName;
  isIllustrated: boolean;
  /** Width of a panel floating over the view's right edge; the picture centres on what is left (CSS px). */
  rightInsetPx: number;
  /** Receives the viewer once it is drawing, and null when it goes, for controls such as Reset view. */
  onViewerChange: (viewer: SeabedViewer | null) => void;
  /** A click or tap on the vessel, a cut marker or a placed position in the 3D view. */
  onTargetPick: (target: SceneTarget) => void;
  /** A flat picture of the case shown in place of the 3D view when it cannot be drawn; null for none. */
  still: ReactNode;
};

/** The 3D seabed: the replay's main view. Time comes from the shared replay clock, read once per frame. */
export function SeabedView({ input, clock, view, isIllustrated, rightInsetPx, onViewerChange, onTargetPick, still }: SeabedViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SeabedViewer | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The latest callbacks, so passing new functions does not rebuild the scene.
  const onViewerChangeRef = useRef(onViewerChange);
  const onTargetPickRef = useRef(onTargetPick);
  useEffect(() => {
    onViewerChangeRef.current = onViewerChange;
    onTargetPickRef.current = onTargetPick;
  }, [onViewerChange, onTargetPick]);

  // Syncs with three.js, a WebGL or WebGPU scene React does not own: built on mount (and on retry), disposed on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;
    let viewer: SeabedViewer | null = null;

    async function startViewer(host: HTMLDivElement) {
      const [loaded, viewerModule] = await Promise.all([loadSeabedData(input.seabedArea), import("@/lib/seabed/scene/viewer")]);
      if (isCancelled) return;
      if (!loaded.ok) {
        console.error(`[SeabedView] ${loaded.reason}`);
        setViewerState({ kind: "failed", reason: "The seabed data could not be loaded." });
        return;
      }
      const created = await viewerModule.createSeabedViewer({
        container: host,
        data: loaded.value,
        input,
        readTimeMs: () => progressToTimeMs(input, clock.getSnapshot().progress),
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onTargetPick: (target) => onTargetPickRef.current(target),
      });
      // The viewer picks its renderer tier asynchronously; an unmount meanwhile frees what it built.
      if (isCancelled) {
        if (created.ok) created.value.dispose();
        return;
      }
      if (!created.ok) {
        console.error(`[SeabedView] ${created.reason}`);
        setViewerState({ kind: "failed", reason: "This browser cannot draw the 3D view (WebGL is off or unavailable)." });
        return;
      }
      viewer = created.value;
      viewerRef.current = created.value;
      onViewerChangeRef.current(created.value);
      setViewerState({ kind: "ready" });
    }

    void startViewer(container);
    return () => {
      isCancelled = true;
      viewer?.dispose();
      viewerRef.current = null;
      onViewerChangeRef.current(null);
    };
  }, [input, clock, attempt]);

  // Mirrors the camera and detail choices into the viewer once it exists.
  useEffect(() => {
    viewerRef.current?.setView(view);
  }, [view, viewerState]);
  useEffect(() => {
    viewerRef.current?.setIllustrated(isIllustrated);
  }, [isIllustrated, viewerState]);
  useEffect(() => {
    viewerRef.current?.setRightInset(rightInsetPx);
  }, [rightInsetPx, viewerState]);

  return (
    <div className="relative h-full w-full" data-testid="seabed-view" data-state={viewerState.kind}>
      <div
        ref={containerRef}
        className="absolute inset-0 transition-opacity duration-220 ease-enter"
        role="img"
        aria-label={`3D model of the seabed with ${input.cuts[0].label} and the track of ${input.vessel.name}`}
      />
      {viewerState.kind === "loading" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-full max-w-xs flex-col gap-3 rounded-inner bg-card p-5 shadow-card" aria-live="polite">
            <p className="text-label">Loading the seabed</p>
            <div className="h-2.5 w-full rounded-full bg-soft" />
            <div className="h-2.5 w-3/4 rounded-full bg-soft" />
          </div>
        </div>
      )}
      {viewerState.kind === "failed" && still && (
        <div className="absolute inset-0" data-testid="seabed-still">
          {still}
        </div>
      )}
      {viewerState.kind === "failed" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-inner bg-card p-5 shadow-card" role="alert">
            <p className="text-label">The 3D view did not load</p>
            <p className="text-small text-muted">
              {viewerState.reason}
              {still ? " The map behind shows the track and the cuts." : ""}
            </p>
            <button
              type="button"
              onClick={() => {
                setViewerState({ kind: "loading" });
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
