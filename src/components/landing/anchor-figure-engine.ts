import { glCamera, glLayer, type GlLayer } from "@/components/iso/gl";
import type { SolidPaths } from "@/components/iso/iso-kit";
import {
  CABLE_SLOTS,
  CHAIN_POINT_COUNT,
  EMPTY_CABLE,
  alongTransform,
  buildAnchorArt,
  buildCableArt,
  buildChainArt,
  buildFurrowArt,
  buildRestingFrame,
  keepCablesNear,
  placeFlukes,
  slideTransform,
  type CableArt,
  type ChainArt,
  type FurrowRun,
} from "@/components/landing/anchor-figure-frame";
import { PLUME_FRAGMENT, plumeScreenBounds } from "@/components/landing/anchor-figure-plume";
import { BLOCK, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import {
  PAID_OUT_MIN_METRES,
  describeCable,
  describeChainForSpeech,
  describeReadout,
  figureMetresPerSecond,
  paidOutMaxMetres,
  readChainAt,
  stepCable,
  tourPaidOutAt,
  type AnchorFigureFacts,
  type CableState,
  type ChainReading,
} from "@/lib/landing/anchor-figure-model";

// The anchor figure's motion, loaded by AnchorFigureLive only once the figure first comes into view, so the front
// page's first load carries none of it (docs/PERFORMANCE.md, the 200 KB budget on `/`). One frame loop steps the model
// (the seabed sliding aft, the chain following its target, cables snagging and parting, the furrow and the silt) and
// writes attributes on the server-drawn SVG; React never re-renders per frame (the Anatomy kit's references/motion.md).

// Seconds the shown chain length takes to follow its target (exponential follow).
const CHAIN_FOLLOW_SECONDS = 0.35;
// The tour starts this long after the figure comes into view, and resumes this long after the reader's last touch.
const TOUR_FIRST_SECONDS = 1.4;
const TOUR_RESUME_MS = 3600;
const LONGEST_FRAME_SECONDS = 1 / 30;
// How long the silt takes to settle in or out (s).
const PLUME_SETTLE_SECONDS = 0.6;

/** The server-drawn nodes the engine writes to. */
export type FigureNodes = {
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  siltProbe: SVGPathElement | null;
  slide: SVGGElement | null;
  trough: SVGPathElement | null;
  lips: SVGPathElement | null;
  cables: (SVGGElement | null)[];
  chain: Record<keyof ChainArt, SVGPathElement | null>;
  anchorParts: (SVGGElement | null)[];
  shackle: SVGPathElement | null;
  stipple: SVGGElement | null;
};

export type FigureEngine = {
  /** Sets the reader's chain target (clamped), holds the tour off, and returns the target. */
  steer: (paidOutMetres: number) => number;
  /** The chain length on screen, and the one being followed, for drags and key steps. */
  readPaidOut: () => { shown: number; target: number; isTouring: boolean };
  /** Holds the tour off without moving the chain (focus). */
  holdTour: () => void;
  /** What the control says for a length of chain. */
  describe: (paidOutMetres: number) => string;
  setRunning: (isRunning: boolean) => void;
  setStill: (isStill: boolean) => void;
  stop: () => void;
};

type Scene = {
  travelled: number;
  shownPaidOut: number;
  targetPaidOut: number;
  reading: ChainReading;
  cables: CableState[];
  runs: FurrowRun[];
  plume: { level: number; velocity: number };
  wasOnSeabed: boolean;
  isTouring: boolean;
  lastTouchMs: number;
  clock: number;
};

/** Writes a solid's paths onto the matching children of its rendered group. */
function writeSolid(group: SVGGElement | null, paths: SolidPaths) {
  if (!group) return;
  group.querySelector(".iso-fill")?.setAttribute("d", paths.fill);
  group.querySelector(".iso-top")?.setAttribute("d", paths.top);
  group.querySelector(".iso-crease")?.setAttribute("d", paths.crease);
  group.querySelector(".iso-edge")?.setAttribute("d", paths.outline);
  group.querySelectorAll<SVGPathElement>(".iso-shade").forEach((node) => node.setAttribute("d", paths.shades[Number(node.dataset.shade ?? 0)] ?? ""));
}

/** Settles a value toward a target with a critically damped spring (the kit's `settle`, kit/gl.mjs). */
function settleLevel(state: { level: number; velocity: number }, target: number, dt: number, seconds: number, isCalm: boolean) {
  if (isCalm) {
    state.level = target;
    state.velocity = 0;
    return;
  }
  const rate = 1 / seconds;
  for (let step = 0; step < 4; step += 1) {
    const slice = dt / 4;
    state.velocity += (rate * rate * (target - state.level) - 2 * rate * state.velocity) * slice;
    state.level += state.velocity * slice;
  }
}

/**
 * Reads the silt token's colour as 0 to 1 RGB from a probe painted with it, for the shader. The token is a color-mix,
 * which the browser may report in oklab, so a one-pixel 2D canvas turns it into sRGB bytes.
 */
function readProbeColour(probe: SVGPathElement | null): [number, number, number] | null {
  if (!probe) return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.fillStyle = getComputedStyle(probe).fill;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

/** Starts the figure from the resting frame the server drew (buildRestingFrame), so the first frame changes nothing. */
export function startFigureEngine(input: { facts: AnchorFigureFacts; nodes: FigureNodes; seabedPeriod: number; isStill: boolean }): FigureEngine {
  const { facts, nodes, seabedPeriod } = input;
  const view = buildFigureView(facts);
  const resting = buildRestingFrame(facts, view);
  const metresPerSecond = figureMetresPerSecond(facts);
  const scene: Scene = {
    travelled: resting.moment.travelledMetres,
    shownPaidOut: resting.moment.paidOutMetres,
    targetPaidOut: resting.moment.paidOutMetres,
    reading: resting.reading,
    cables: resting.cables,
    runs: resting.runs.map((run) => ({ ...run })),
    plume: { level: 1, velocity: 0 },
    wasOnSeabed: true,
    isTouring: true,
    lastTouchMs: -Infinity,
    clock: 0,
  };
  let isStill = input.isStill;
  let isRunning = false;
  let frame = 0;
  let lastNow = 0;
  let shownText = resting.readout;
  let drawnPaidOut = scene.shownPaidOut;
  let lastAnchor = resting.anchor;

  const silt = readProbeColour(nodes.siltProbe);
  // Without the token's colour there is no right ink for the cloud, so the SVG stipple stays instead.
  const layer: GlLayer | null =
    nodes.canvas && silt
      ? glLayer({
          canvas: nodes.canvas,
          fragment: PLUME_FRAGMENT,
          view: [VIEW_WIDTH, VIEW_HEIGHT],
          camera: glCamera(view.projection),
          uniforms: ["uFluke", "uRunStart", "uTravel", "uActive", "uBounds"],
          fixed: { uSilt: silt, uBlock: [BLOCK.x, BLOCK.x + BLOCK.w] },
        })
      : null;
  if (layer) nodes.stage.setAttribute("data-gl", "");

  const draw = () => {
    if (Math.abs(scene.shownPaidOut - drawnPaidOut) > 0.02) {
      drawnPaidOut = scene.shownPaidOut;
      scene.reading = readChainAt(facts, scene.shownPaidOut, CHAIN_POINT_COUNT);
      const chain = buildChainArt(view, scene.reading);
      for (const key of Object.keys(nodes.chain) as (keyof ChainArt)[]) nodes.chain[key]?.setAttribute("d", chain[key]);
      lastAnchor = buildAnchorArt(view, scene.reading);
      lastAnchor.parts.forEach((paths, index) => writeSolid(nodes.anchorParts[index] ?? null, paths));
      nodes.shackle?.setAttribute("d", lastAnchor.shackle);
    }
    nodes.slide?.setAttribute("transform", slideTransform(view, scene.travelled, seabedPeriod));
    const furrow = buildFurrowArt(view, scene.runs, scene.travelled);
    nodes.trough?.setAttribute("d", furrow.trough);
    nodes.lips?.setAttribute("d", furrow.lips);
    for (let index = 0; index < CABLE_SLOTS; index += 1) {
      const cable = scene.cables[index];
      const art = cable ? buildCableArt(view, cable, scene.travelled, lastAnchor.flukeTip[0]) : EMPTY_CABLE;
      nodes.cables[index]?.querySelectorAll<SVGPathElement>("[data-part]").forEach((node) => node.setAttribute("d", art[node.dataset.part as keyof CableArt] ?? ""));
    }
    if (nodes.stipple) {
      nodes.stipple.setAttribute("transform", alongTransform(view, lastAnchor.flukeTip[0]));
      nodes.stipple.style.opacity = scene.plume.level.toFixed(3);
    }
    if (layer) {
      const currentRun = scene.runs.at(-1);
      if (scene.plume.level > 0.002) {
        layer.draw(
          {
            uFluke: [lastAnchor.flukeTip[0], view.chainY],
            uRunStart: currentRun ? currentRun.fromWorld - scene.travelled : BLOCK.x,
            uTravel: scene.travelled,
            uActive: scene.plume.level,
            uBounds: plumeScreenBounds(view, lastAnchor.flukeTip[0]),
          },
          isStill ? 0.8 : scene.clock,
        );
      } else layer.clear();
    }
    const text = describeReadout(facts, scene.reading, describeCable(scene.cables, placeFlukes(lastAnchor, scene.reading), scene.travelled));
    if (text !== shownText) {
      shownText = text;
      const slot = nodes.stage.closest(".iso-plate")?.querySelector("[data-readout]");
      if (slot) slot.textContent = text;
    }
  };

  const tick = (now: number) => {
    const dt = lastNow ? Math.min((now - lastNow) / 1000, LONGEST_FRAME_SECONDS) : 1 / 60;
    lastNow = now;
    if (!isStill) {
      scene.clock += dt;
      scene.travelled += metresPerSecond * dt;
      if (now - scene.lastTouchMs > TOUR_RESUME_MS && scene.clock > TOUR_FIRST_SECONDS) scene.isTouring = true;
      if (scene.isTouring) scene.targetPaidOut = tourPaidOutAt(facts, scene.travelled);
    }
    const follow = isStill ? 1 : 1 - Math.exp(-dt / CHAIN_FOLLOW_SECONDS);
    scene.shownPaidOut += (scene.targetPaidOut - scene.shownPaidOut) * follow;
    if (Math.abs(scene.targetPaidOut - scene.shownPaidOut) < 0.01) scene.shownPaidOut = scene.targetPaidOut;
    // The cables and the furrow follow the anchor as it stands this frame.
    const flukes = placeFlukes(lastAnchor, scene.reading);
    scene.cables = keepCablesNear(scene.cables, scene.travelled).map((cable) => stepCable(cable, flukes, scene.travelled));
    const flukeWorld = scene.travelled + flukes.aheadOfHawseMetres;
    // A run of furrow stays open while the flukes stay in the seabed; it widens to wherever they have been.
    const lastRun = scene.runs.at(-1);
    if (flukes.isOnSeabed) {
      if (lastRun && scene.wasOnSeabed) {
        lastRun.fromWorld = Math.min(lastRun.fromWorld, flukeWorld);
        lastRun.toWorld = Math.max(lastRun.toWorld, flukeWorld);
      } else scene.runs.push({ fromWorld: flukeWorld, toWorld: flukeWorld });
    }
    scene.wasOnSeabed = flukes.isOnSeabed;
    scene.runs = scene.runs.filter((run) => run.toWorld - scene.travelled > BLOCK.x - 10);
    settleLevel(scene.plume, flukes.isOnSeabed ? 1 : 0, dt, PLUME_SETTLE_SECONDS, isStill);
    draw();
    // Under reduced motion the world holds still and the loop stops once the chain has reached its target.
    const isMoving = !isStill || scene.shownPaidOut !== scene.targetPaidOut;
    frame = isRunning && isMoving ? requestAnimationFrame(tick) : 0;
  };

  const wake = () => {
    if (frame || !isRunning) return;
    lastNow = 0;
    frame = requestAnimationFrame(tick);
  };

  return {
    steer(paidOutMetres) {
      const clamped = Math.min(paidOutMaxMetres(facts), Math.max(PAID_OUT_MIN_METRES, paidOutMetres));
      scene.isTouring = false;
      scene.lastTouchMs = performance.now();
      scene.targetPaidOut = clamped;
      wake();
      return clamped;
    },
    readPaidOut: () => ({ shown: scene.shownPaidOut, target: scene.targetPaidOut, isTouring: scene.isTouring }),
    holdTour() {
      scene.isTouring = false;
      scene.lastTouchMs = performance.now();
    },
    describe: (paidOutMetres) => describeChainForSpeech(readChainAt(facts, paidOutMetres, 8)),
    setRunning(next) {
      isRunning = next;
      if (next) wake();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    setStill(next) {
      isStill = next;
      wake();
    },
    stop() {
      isRunning = false;
      cancelAnimationFrame(frame);
      frame = 0;
      layer?.clear();
      nodes.stage.removeAttribute("data-gl");
    },
  };
}
