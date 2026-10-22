import { glCamera, glLayer, type GlLayer } from "@/components/iso/gl";
import { CHAIN_POINT_COUNT, alongTransform, buildRestingFrame, keepCablesNear, placeFlukes, slideTransform, type FurrowRun } from "@/components/landing/anchor-figure-frame";
import { PLUME_FRAGMENT, plumeScreenBounds } from "@/components/landing/anchor-figure-plume";
import { CHAIN_SLOTS, SEABED_SLOTS, buildChainSlots, buildSeabedSlots, type ChainSlot, type SeabedSlot } from "@/components/landing/anchor-figure-svg";
import { BLOCK, TEXTURE_PERIOD_METRES, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import {
  describeCable,
  describeChainForSpeech,
  describeReadout,
  figureMetresPerSecond,
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
// rewrites the drawing's slots (anchor-figure-svg.ts) with the builders that drew them; React never re-renders per
// frame (the Anatomy kit's references/motion.md).

// Seconds the shown chain length takes to follow its target (exponential follow).
const CHAIN_FOLLOW_SECONDS = 0.35;
// The tour starts this long after the figure comes into view, and resumes this long after the reader's last touch.
const TOUR_FIRST_SECONDS = 1.4;
const TOUR_RESUME_MS = 3600;
const LONGEST_FRAME_SECONDS = 1 / 30;
// How long the silt takes to settle in or out (s).
const PLUME_SETTLE_SECONDS = 0.6;

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

/** Finds the drawing's slot groups by their `data-slot` names. */
function findSlots<Name extends string>(stage: HTMLElement, names: readonly Name[]): Map<Name, SVGGElement> {
  const found = new Map<Name, SVGGElement>();
  for (const name of names) {
    const node = stage.querySelector<SVGGElement>(`[data-slot="${name}"]`);
    if (node) found.set(name, node);
  }
  return found;
}

/** Writes markup into slots, touching only those whose markup changed since the last write. */
function writeSlots<Name extends string>(slots: Map<Name, SVGGElement>, markup: Record<Name, string>, written: Map<Name, string>) {
  for (const [name, node] of slots) {
    const next = markup[name];
    if (written.get(name) === next) continue;
    written.set(name, next);
    node.innerHTML = next;
  }
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

/** Starts the figure from the resting frame the drawing shows (buildRestingFrame), so the first frame changes nothing. */
export function startFigureEngine(input: { facts: AnchorFigureFacts; stage: HTMLDivElement; canvas: HTMLCanvasElement | null; isStill: boolean }): FigureEngine {
  const { facts, stage } = input;
  const view = buildFigureView(facts);
  const [leastPaidOut, mostPaidOut] = view.paidOutRange;
  const chainSlots = findSlots<ChainSlot>(stage, CHAIN_SLOTS);
  const seabedSlots = findSlots<SeabedSlot>(stage, SEABED_SLOTS);
  const slide = stage.querySelector<SVGGElement>('[data-slot="slide"]');
  const stipple = stage.querySelector<SVGGElement>('[data-slot="stipple"]');
  const writtenChain = new Map<ChainSlot, string>();
  const writtenSeabed = new Map<SeabedSlot, string>();
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

  const silt = readProbeColour(stage.querySelector<SVGPathElement>(".af-silt-probe"));
  // Without the token's colour there is no right ink for the cloud, so the SVG stipple stays instead.
  const layer: GlLayer | null =
    input.canvas && silt
      ? glLayer({
          canvas: input.canvas,
          fragment: PLUME_FRAGMENT,
          view: [VIEW_WIDTH, VIEW_HEIGHT],
          camera: glCamera(view.projection),
          uniforms: ["uFluke", "uRunStart", "uTravel", "uActive", "uBounds"],
          fixed: { uSilt: silt, uBlock: [BLOCK.x, BLOCK.x + BLOCK.w] },
        })
      : null;
  if (layer) stage.setAttribute("data-gl", "");

  const draw = () => {
    if (Math.abs(scene.shownPaidOut - drawnPaidOut) > 0.02) {
      drawnPaidOut = scene.shownPaidOut;
      scene.reading = readChainAt(facts, scene.shownPaidOut, CHAIN_POINT_COUNT);
      const chain = buildChainSlots(view, scene.reading);
      lastAnchor = chain.anchor;
      writeSlots(chainSlots, chain.slots, writtenChain);
    }
    slide?.setAttribute("transform", slideTransform(view, scene.travelled, TEXTURE_PERIOD_METRES));
    writeSlots(seabedSlots, buildSeabedSlots(view, { travelled: scene.travelled, runs: scene.runs, cables: scene.cables, anchor: lastAnchor }), writtenSeabed);
    if (stipple) {
      stipple.setAttribute("transform", alongTransform(view, lastAnchor.flukeTip[0]));
      stipple.style.opacity = scene.plume.level.toFixed(3);
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
      const slot = stage.closest(".iso-plate")?.querySelector("[data-readout]");
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
      if (scene.isTouring) scene.targetPaidOut = tourPaidOutAt(facts, scene.travelled, view.tourPaidOut);
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
      const clamped = Math.min(mostPaidOut, Math.max(leastPaidOut, paidOutMetres));
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
      stage.removeAttribute("data-gl");
    },
  };
}
