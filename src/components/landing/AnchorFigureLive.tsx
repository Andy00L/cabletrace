"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Dots } from "@/components/iso/draw";
import type { SolidPaths } from "@/components/iso/iso-kit";
import type { CableArt, ChainArt } from "@/components/landing/anchor-figure-frame";
import type { FigureEngine, FigureNodes } from "@/components/landing/anchor-figure-engine";
import type { AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";

// The live half of the front page's anchor figure. It renders the resting frame the server computed (every path as a
// prop), and loads the motion (anchor-figure-engine.ts: the model, the per-frame geometry and the silt shader) only
// once the figure first comes into view, so the page's first load carries none of it. The engine writes attributes
// on these nodes from one frame loop; this component re-renders only when the reader's choice changes.

// Keyboard steps (m of chain), and the shift step.
const KEY_STEP_METRES = 10;
const KEY_BIG_STEP_METRES = 50;
// A drag across the whole figure covers this share of the chain's range more than its width, so a short drag reads.
const DRAG_GAIN = 1.3;
const STILLNESS_QUERY = "(prefers-reduced-motion: reduce)";

/** Subscribes to the reader's reduced-motion setting (matchMedia, an external system). */
function subscribeToStillness(onChange: () => void) {
  const query = window.matchMedia(STILLNESS_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const readStillness = () => window.matchMedia(STILLNESS_QUERY).matches;
const readServerStillness = () => false;

/** The resting frame, as path strings the server built (anchor-figure-frame.ts, buildRestingFrame). */
export type RestingArt = {
  chain: ChainArt;
  anchorParts: SolidPaths[];
  shackle: string;
  furrow: { trough: string; lips: string };
  cables: CableArt[];
  stipple: [number, number, number][];
  slide: string;
  stippleTransform: string;
  speech: string;
  paidOutMetres: number;
  paidOutRange: [number, number];
};

/** A solid whose every tone path is rendered, so the engine always finds the slot to write. */
function SolidSlot({ paths, slot }: { paths: SolidPaths; slot: (node: SVGGElement | null) => void }) {
  return (
    <g ref={slot} className="iso-solid" data-lit="">
      <path className="iso-fill" d={paths.fill} />
      {[0, 1, 2, 3].map((shade) => (
        <path key={shade} className="iso-shade" data-shade={shade} d={paths.shades[shade] ?? ""} />
      ))}
      <path className="iso-top" d={paths.top} />
      <path className="iso-line iso-crease" data-tone="faint" d={paths.crease} />
      <path className="iso-line iso-edge" data-tone="hi" d={paths.outline} />
    </g>
  );
}

type Props = {
  facts: AnchorFigureFacts;
  label: string;
  resting: RestingArt;
  viewBox: string;
  seabedPeriod: number;
  seabedClip: string;
  waterClip: string;
  fade: { from: [number, number]; to: [number, number]; width: number; height: number };
  back: ReactNode;
  seabedTexture: ReactNode;
  waterBack: ReactNode;
  hullUnderwater: ReactNode;
  surface: ReactNode;
  shipAbove: ReactNode;
  waterFront: ReactNode;
  scale: ReactNode;
};

export function AnchorFigureLive(props: Props) {
  const { facts, resting } = props;
  const [minPaidOut, maxPaidOut] = resting.paidOutRange;
  const isStill = useSyncExternalStore(subscribeToStillness, readStillness, readServerStillness);
  const [isVisible, setIsVisible] = useState(false);
  const [spoken, setSpoken] = useState(resting.speech);
  const [paidOutNow, setPaidOutNow] = useState(resting.paidOutMetres);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FigureEngine | null>(null);
  const isStillRef = useRef(isStill);
  const isVisibleRef = useRef(isVisible);
  const dragRef = useRef<{ pointerId: number; startX: number; startPaidOut: number } | null>(null);
  const nodesRef = useRef<Omit<FigureNodes, "stage">>({
    canvas: null,
    siltProbe: null,
    slide: null,
    trough: null,
    lips: null,
    cables: [],
    chain: { behindHull: null, front: null, studs: null, aboveWater: null, aboveStuds: null },
    anchorParts: [],
    shackle: null,
    stipple: null,
  });

  // The stage's visibility (IntersectionObserver, an external system): motion and the shader run only on screen. No
  // margin: the motion's 12 KB load waits until the figure is really in view (below the fold at 1440 by 900), so a
  // visit that never scrolls to it never pays for it (docs/PERFORMANCE.md, JS on `/`).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver((entries) => setIsVisible(Boolean(entries.at(-1)?.isIntersecting)));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // The engine (a frame loop and a WebGL context): loaded on the first view, paused off screen, stopped on unmount.
  useEffect(() => {
    isVisibleRef.current = isVisible;
    if (engineRef.current) {
      engineRef.current.setRunning(isVisible);
      return;
    }
    if (!isVisible) return;
    let isCancelled = false;
    import("@/components/landing/anchor-figure-engine")
      .then(({ startFigureEngine }) => {
        const stage = stageRef.current;
        if (isCancelled || !stage || engineRef.current) return;
        const engine = startFigureEngine({ facts, nodes: { stage, ...nodesRef.current }, seabedPeriod: props.seabedPeriod, isStill: isStillRef.current });
        engineRef.current = engine;
        engine.setRunning(isVisibleRef.current);
      })
      .catch((error: unknown) => console.error(`[AnchorFigureLive] motion did not load: ${error instanceof Error ? error.message : String(error)}`));
    return () => {
      isCancelled = true;
    };
  }, [isVisible, facts, props.seabedPeriod]);

  useEffect(() => {
    isStillRef.current = isStill;
    engineRef.current?.setStill(isStill);
  }, [isStill]);

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
    // Start from the length on screen, not the tour's target, so the chain never jumps under the pointer.
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
    const { shown, target, isTouring } = engine.readPaidOut();
    // Keys step from the length on screen while touring, so a press always moves the way the key says.
    const from = isTouring ? shown : target;
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
      onFocus={() => engineRef.current?.holdTour()}
    >
      <svg className="iso-svg af-back" viewBox={props.viewBox} role="img" aria-label={props.label} focusable="false">
        <defs>
          <clipPath id="af-seabed-clip">
            <path d={props.seabedClip} />
          </clipPath>
          <clipPath id="af-water-clip">
            <path d={props.waterClip} />
          </clipPath>
          <linearGradient id="af-seabed-fade-ramp" gradientUnits="userSpaceOnUse" x1={props.fade.from[0]} y1={props.fade.from[1]} x2={props.fade.to[0]} y2={props.fade.to[1]}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.06" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.96" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="af-seabed-fade" maskUnits="userSpaceOnUse" x="0" y="0" width={props.fade.width} height={props.fade.height}>
            <rect x="0" y="0" width={props.fade.width} height={props.fade.height} fill="url(#af-seabed-fade-ramp)" />
          </mask>
        </defs>
        {/* Never painted: it only carries the silt token, which the shader reads for its ink. */}
        <path ref={(node) => { nodesRef.current.siltProbe = node; }} className="af-silt-probe" d="M0 0" />
        {props.back}
        <g clipPath="url(#af-seabed-clip)">
          <g mask="url(#af-seabed-fade)">
            <g ref={(node) => { nodesRef.current.slide = node; }} transform={resting.slide}>
              {props.seabedTexture}
            </g>
            <path ref={(node) => { nodesRef.current.trough = node; }} className="af-furrow" d={resting.furrow.trough} />
            <path ref={(node) => { nodesRef.current.lips = node; }} className="iso-line" data-tone="lo" d={resting.furrow.lips} />
          </g>
          {resting.cables.map((art, index) => (
            <g key={index} className="af-cable" ref={(node) => { nodesRef.current.cables[index] = node; }}>
              <path data-part="body" className="af-cable-body" d={art.body} />
              <path data-part="shade" className="af-cable-shade" d={art.shade} />
              <path data-part="armour" className="iso-line af-cable-armour" data-tone="lo" d={art.armour} />
              <path data-part="edges" className="iso-line" data-tone="hi" d={art.edges} />
              <path data-part="sections" className="iso-line af-cable-section" data-tone="mid" d={art.sections} />
              <path data-part="frayed" className="iso-line af-cut" d={art.frayed} />
            </g>
          ))}
        </g>
        <g clipPath="url(#af-water-clip)">
          <g ref={(node) => { nodesRef.current.stipple = node; }} className="af-plume-fallback" transform={resting.stippleTransform}>
            <Dots points={resting.stipple} size={0.42} tone="lo" />
          </g>
        </g>
        {props.waterBack}
      </svg>
      <canvas ref={(node) => { nodesRef.current.canvas = node; }} className="af-layer af-gl" aria-hidden="true" />
      <svg className="iso-svg af-layer af-front" viewBox={props.viewBox} aria-hidden="true" focusable="false">
        <path ref={(node) => { nodesRef.current.chain.behindHull = node; }} className="iso-line af-chain" data-tone="lit" d={resting.chain.behindHull} />
        {props.hullUnderwater}
        {resting.anchorParts.map((paths, index) => (
          <SolidSlot key={index} paths={paths} slot={(node) => { nodesRef.current.anchorParts[index] = node; }} />
        ))}
        <path ref={(node) => { nodesRef.current.shackle = node; }} className="iso-line af-shackle" data-tone="lit" d={resting.shackle} />
        <path ref={(node) => { nodesRef.current.chain.front = node; }} className="iso-line af-chain" data-tone="lit" d={resting.chain.front} />
        <path ref={(node) => { nodesRef.current.chain.studs = node; }} className="iso-line af-chain-stud" data-tone="lit" d={resting.chain.studs} />
        {props.surface}
        {props.shipAbove}
        <path ref={(node) => { nodesRef.current.chain.aboveWater = node; }} className="iso-line af-chain" data-tone="lit" d={resting.chain.aboveWater} />
        <path ref={(node) => { nodesRef.current.chain.aboveStuds = node; }} className="iso-line af-chain-stud" data-tone="lit" d={resting.chain.aboveStuds} />
        {props.waterFront}
        {props.scale}
      </svg>
    </div>
  );
}
