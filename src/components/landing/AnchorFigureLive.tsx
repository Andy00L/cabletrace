"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { useFigureStage } from "@/components/landing/AnchorFigureStage";
import type { FigureEngine } from "@/components/landing/anchor-figure-engine";
import type { AnchorFigureFacts, FigureStage } from "@/lib/landing/anchor-figure-model";

// The live half of the front page's anchor figure. It renders an empty stage at the drawing's size (so nothing moves
// when the drawing arrives), fetches the drawing from the figure's route once the figure nears the view and moves its
// two layers into the stage, then loads the motion (anchor-figure-engine.ts: the model, the per-frame builders and
// the silt shader) once the figure is really in view. The engine rewrites the drawing's slots from one frame loop;
// this component re-renders only when the reader's choice or the page's stage (AnchorFigureStage) changes.

// Keyboard steps (m of chain), and the shift step.
const KEY_STEP_METRES = 10;
const KEY_BIG_STEP_METRES = 50;
// A drag across the whole figure covers this share of the chain's range more than its width, so a short drag reads.
const DRAG_GAIN = 1.3;
const STILLNESS_QUERY = "(prefers-reduced-motion: reduce)";
// The drawing is fetched this far ahead of the view (a share of the viewport's height), so it is there when it shows.
const DRAWING_AHEAD = "100% 0px";

/** Subscribes to the reader's reduced-motion setting (matchMedia, an external system). */
function subscribeToStillness(onChange: () => void) {
  const query = window.matchMedia(STILLNESS_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const readStillness = () => window.matchMedia(STILLNESS_QUERY).matches;
const readServerStillness = () => false;

/** Moves one layer of the fetched drawing into its stage SVG; false when the layer is missing. */
function mountLayer(drawing: Document, layer: "back" | "front", into: SVGSVGElement | null): boolean {
  const source = drawing.querySelector(`[data-layer="${layer}"]`);
  if (!source || !into) return false;
  into.replaceChildren(document.importNode(source, true));
  return true;
}

/** Calls back once with true when the element comes within `margin` of the viewport (IntersectionObserver). */
function watchView(element: Element, margin: string, onChange: (isNear: boolean) => void) {
  const observer = new IntersectionObserver((entries) => onChange(Boolean(entries.at(-1)?.isIntersecting)), { rootMargin: margin });
  observer.observe(element);
  return () => observer.disconnect();
}

type Props = {
  facts: AnchorFigureFacts;
  label: string;
  svgPath: string;
  viewBox: string;
  speech: string;
  paidOutMetres: number;
  paidOutRange: [number, number];
  /** The stage to show when no AnchorFigureStage encloses the figure. */
  initialStage: FigureStage;
};

export function AnchorFigureLive(props: Props) {
  const { facts, svgPath } = props;
  const [minPaidOut, maxPaidOut] = props.paidOutRange;
  const isStill = useSyncExternalStore(subscribeToStillness, readStillness, readServerStillness);
  const figureStage = useFigureStage() ?? props.initialStage;
  const figureStageRef = useRef(figureStage);
  const [isNear, setIsNear] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isDrawn, setIsDrawn] = useState(false);
  const [spoken, setSpoken] = useState(props.speech);
  const [paidOutNow, setPaidOutNow] = useState(props.paidOutMetres);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<SVGSVGElement | null>(null);
  const frontRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<FigureEngine | null>(null);
  const isStillRef = useRef(isStill);
  const isVisibleRef = useRef(isVisible);
  const dragRef = useRef<{ pointerId: number; startX: number; startPaidOut: number } | null>(null);

  // Two watches on the stage (IntersectionObserver, an external system): near the view fetches the drawing; in view
  // runs the motion. The motion's chunk waits until the figure is really seen (below the fold at 1440 by 900), so a
  // visit that never scrolls to it never pays for it (docs/PERFORMANCE.md, JS on `/`).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stopNear = watchView(stage, DRAWING_AHEAD, (isClose) => {
      if (isClose) setIsNear(true);
    });
    const stopVisible = watchView(stage, "0px", setIsVisible);
    return () => {
      stopNear();
      stopVisible();
    };
  }, []);

  // The drawing (a network fetch): once, when the figure first nears the view.
  useEffect(() => {
    if (!isNear) return;
    const controller = new AbortController();
    fetch(svgPath, { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((text) => {
        const drawing = new DOMParser().parseFromString(text, "image/svg+xml");
        const isMounted = mountLayer(drawing, "back", backRef.current) && mountLayer(drawing, "front", frontRef.current);
        if (!isMounted) throw new Error("the drawing has no back or front layer");
        setIsDrawn(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(`[AnchorFigureLive] drawing did not load: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => controller.abort();
  }, [isNear, svgPath]);

  // The engine (a frame loop and a WebGL context): loaded on the first view of the drawn figure, paused off screen.
  useEffect(() => {
    isVisibleRef.current = isVisible;
    if (engineRef.current) {
      engineRef.current.setRunning(isVisible);
      return;
    }
    if (!isVisible || !isDrawn) return;
    let isCancelled = false;
    import("@/components/landing/anchor-figure-engine")
      .then(({ startFigureEngine }) => {
        const stage = stageRef.current;
        if (isCancelled || !stage || engineRef.current) return;
        const engine = startFigureEngine({ facts, stage, canvas: canvasRef.current, isStill: isStillRef.current, figureStage: figureStageRef.current });
        engineRef.current = engine;
        engine.setRunning(isVisibleRef.current);
      })
      .catch((error: unknown) => console.error(`[AnchorFigureLive] motion did not load: ${error instanceof Error ? error.message : String(error)}`));
    return () => {
      isCancelled = true;
    };
  }, [isVisible, isDrawn, facts]);

  useEffect(() => {
    isStillRef.current = isStill;
    engineRef.current?.setStill(isStill);
  }, [isStill]);

  // The page's stage, played on the engine's loop (an external system); before the engine loads it waits in the ref.
  useEffect(() => {
    figureStageRef.current = figureStage;
    const engine = engineRef.current;
    if (!engine) return;
    const paidOut = engine.setStage(figureStage);
    setPaidOutNow(Math.round(paidOut));
    setSpoken(engine.describe(paidOut));
  }, [figureStage]);

  useEffect(() => () => engineRef.current?.stop(), []);

  const announce = (paidOut: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    setPaidOutNow(Math.round(paidOut));
    setSpoken(engine.describe(paidOut));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (event.button !== 0 || !engine) return;
    // Start from the length on screen, so the chain never jumps under the pointer.
    const { shown } = engine.readPaidOut();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startPaidOut: shown };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.held = "";
    engine.steer(shown);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = event.currentTarget.getBoundingClientRect().width || 1;
    // Dragging left (aft, the way the chain runs) pays out; right hauls in.
    engineRef.current?.steer(drag.startPaidOut - ((event.clientX - drag.startX) / width) * (maxPaidOut - minPaidOut) * DRAG_GAIN);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.held;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const engine = engineRef.current;
    if (engine) announce(engine.readPaidOut().target);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const step = event.shiftKey ? KEY_BIG_STEP_METRES : KEY_STEP_METRES;
    // Keys step from the length being followed: during a stage's step that is the length on screen.
    const from = engine.readPaidOut().target;
    const targets: Record<string, number> = { ArrowLeft: from + step, ArrowDown: from + step, ArrowRight: from - step, ArrowUp: from - step, Home: minPaidOut, End: maxPaidOut };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    announce(engine.steer(next));
  };

  return (
    <div
      ref={stageRef}
      className="af-stage"
      data-drawn={isDrawn ? "" : undefined}
      tabIndex={0}
      role="slider"
      aria-label="Chain paid out. Left and right arrows pay out or haul in 10 metres, with Shift 50; Home and End go to the ends."
      aria-valuemin={minPaidOut}
      aria-valuemax={maxPaidOut}
      aria-valuenow={paidOutNow}
      aria-valuetext={spoken}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="af-art">
        <svg ref={backRef} className="iso-svg af-back" viewBox={props.viewBox} role="img" aria-label={props.label} focusable="false" />
        <canvas ref={canvasRef} className="af-layer af-gl" aria-hidden="true" />
        <svg ref={frontRef} className="iso-svg af-layer af-front" viewBox={props.viewBox} aria-hidden="true" focusable="false" />
      </div>
    </div>
  );
}
