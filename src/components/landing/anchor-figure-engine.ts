import { glCamera, glLayer, type GlLayer } from "@/components/iso/gl";
import { CHAIN_POINT_COUNT, alongTransform, buildAnchorArt, layCablesNear, placeFlukes, readDragHook, readFurrowRuns, slideTransform } from "@/components/landing/anchor-figure-frame";
import { PLUME_FRAGMENT, plumeScreenBounds } from "@/components/landing/anchor-figure-plume";
import { CHAIN_SLOTS, DRAWN_STAGE, SEABED_SLOTS, buildChainSlots, buildSeabedSlots, type ChainSlot, type SeabedSlot } from "@/components/landing/anchor-figure-svg";
import { BLOCK, TEXTURE_PERIOD_METRES, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import { describeCable, describeChainForSpeech, describeReadout, readChainAt, readStageMoment, type AnchorFigureFacts, type FigureStage } from "@/lib/landing/anchor-figure-model";

// The anchor figure's motion, loaded by AnchorFigureLive only once the figure first comes into view, so the front
// page's first load carries none of it (docs/PERFORMANCE.md, the 200 KB budget on `/`). The page steps the figure
// through its three stages (drop, drag, cut); each step plays the drag between the two moments on one frame loop: the
// seabed sliding aft, the chain paying out or hauling in, the cable snagging and parting on the way. The loop rewrites
// the drawing's slots (anchor-figure-svg.ts) with the builders that drew them; React never re-renders per frame (the
// Anatomy kit's references/motion.md).

// A step between stages takes this long (ms), inside the 600 to 900 ms the page's motion uses for a change of state.
const STAGE_STEP_MS = 900;
// Seconds the chain takes to follow the reader's own drag or key (exponential follow).
const CHAIN_FOLLOW_SECONDS = 0.35;
// A frame longer than this (a busy or slow device, a tab coming back) counts as this long, so the silt still settles
// in about its own time without leaping.
const LONGEST_FRAME_SECONDS = 0.1;
// How long the silt and the furrow take to settle in or out (s).
const PLUME_SETTLE_SECONDS = 0.6;

export type FigureEngine = {
  /** Plays the drag to a stage, or jumps there under reduced motion; returns the chain out at that stage. */
  setStage: (stage: FigureStage) => number;
  /** Sets the reader's chain target (clamped) and returns it. */
  steer: (paidOutMetres: number) => number;
  /** The chain length on screen, and the one being followed, for drags and key steps. */
  readPaidOut: () => { shown: number; target: number };
  /** What the control says for a length of chain. */
  describe: (paidOutMetres: number) => string;
  setRunning: (isRunning: boolean) => void;
  setStill: (isStill: boolean) => void;
  stop: () => void;
};

type Step = { fromTravelled: number; toTravelled: number; fromPaidOut: number; toPaidOut: number; startMs: number };

/**
 * The page's standard easing, cubic-bezier(0.4, 0, 0.2, 1) (`--ease-standard`, sourceRef src/app/globals.css), as a
 * function of time share: solved for the curve's x by Newton's method, then read for its y.
 */
function easeStandard(share: number): number {
  const [x1, y1, x2, y2] = [0.4, 0, 0.2, 1];
  const curve = (along: number, first: number, second: number) => 3 * (1 - along) ** 2 * along * first + 3 * (1 - along) * along ** 2 * second + along ** 3;
  const slope = (along: number, first: number, second: number) => 3 * (1 - along) ** 2 * first + 6 * (1 - along) * along * (second - first) + 3 * along ** 2 * (1 - second);
  let along = share;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const gradient = slope(along, x1, x2);
    if (Math.abs(gradient) < 1e-6) break;
    along = Math.min(1, Math.max(0, along - (curve(along, x1, x2) - share) / gradient));
  }
  return curve(along, y1, y2);
}

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

/** Starts the figure from the stage the drawing shows (DRAWN_STAGE), then moves at once to `figureStage`. */
export function startFigureEngine(input: { facts: AnchorFigureFacts; stage: HTMLDivElement; canvas: HTMLCanvasElement | null; isStill: boolean; figureStage: FigureStage }): FigureEngine {
  const { facts, stage } = input;
  const view = buildFigureView(facts);
  const [leastPaidOut, mostPaidOut] = view.paidOutRange;
  const hookAhead = readDragHook(facts, view);
  const momentOf = (figureStage: FigureStage) => readStageMoment(figureStage, { snagAtMetres: -hookAhead, draggingPaidOutMetres: view.dragPaidOut });
  const chainSlots = findSlots<ChainSlot>(stage, CHAIN_SLOTS);
  const seabedSlots = findSlots<SeabedSlot>(stage, SEABED_SLOTS);
  const slide = stage.querySelector<SVGGElement>('[data-slot="slide"]');
  const stipple = stage.querySelector<SVGGElement>('[data-slot="stipple"]');
  const furrows = [...stage.querySelectorAll<SVGGElement>('[data-slot="furrow-back"], [data-slot="furrow-front"]')];
  const writtenChain = new Map<ChainSlot, string>();
  const writtenSeabed = new Map<SeabedSlot, string>();
  const drawn = momentOf(DRAWN_STAGE);
  let travelled = drawn.travelledMetres;
  let shownPaidOut = drawn.paidOutMetres;
  let targetPaidOut = drawn.paidOutMetres;
  let step: Step | null = null;
  let reading = readChainAt(facts, shownPaidOut, CHAIN_POINT_COUNT);
  let anchor = buildAnchorArt(view, reading);
  const plume = { level: anchor.isDug ? 1 : 0, velocity: 0 };
  let isStill = input.isStill;
  let isRunning = false;
  let frame = 0;
  let lastNow = 0;
  let clock = 0;
  let shownText = "";
  let drawnPaidOut = shownPaidOut;
  let drawnSeabed = "";

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
    if (Math.abs(shownPaidOut - drawnPaidOut) > 0.02) {
      drawnPaidOut = shownPaidOut;
      reading = readChainAt(facts, shownPaidOut, CHAIN_POINT_COUNT);
      const chain = buildChainSlots(view, reading);
      anchor = chain.anchor;
      writeSlots(chainSlots, chain.slots, writtenChain);
    }
    const runs = readFurrowRuns(travelled, anchor);
    const cables = layCablesNear(travelled, hookAhead);
    // The seabed is rebuilt only when the ship or the chain has moved.
    const seabedKey = `${travelled.toFixed(2)}|${drawnPaidOut.toFixed(2)}`;
    if (seabedKey !== drawnSeabed) {
      drawnSeabed = seabedKey;
      slide?.setAttribute("transform", slideTransform(view, travelled, TEXTURE_PERIOD_METRES));
      writeSlots(seabedSlots, buildSeabedSlots(view, { travelled, runs, cables, anchor }), writtenSeabed);
    }
    // The furrow comes in with the silt as the flukes bite, rather than appearing whole.
    const settled = plume.level.toFixed(3);
    for (const furrow of furrows) furrow.style.opacity = settled;
    if (stipple) {
      stipple.setAttribute("transform", alongTransform(view, anchor.flukeTip[0]));
      stipple.style.opacity = settled;
    }
    if (layer) {
      const currentRun = runs.at(-1);
      if (plume.level > 0.002) {
        layer.draw(
          {
            uFluke: [anchor.flukeTip[0], view.chainY],
            uRunStart: currentRun ? currentRun.fromWorld - travelled : BLOCK.x,
            uTravel: travelled,
            uActive: plume.level,
            uBounds: plumeScreenBounds(view, anchor.flukeTip[0]),
          },
          isStill ? 0.8 : clock,
        );
      } else layer.clear();
    }
    const text = describeReadout(facts, reading, describeCable(cables, placeFlukes(anchor, reading), travelled));
    if (text !== shownText) {
      shownText = text;
      const slot = stage.closest(".af")?.querySelector("[data-readout]");
      if (slot) slot.textContent = text;
    }
  };

  const tick = (now: number) => {
    const dt = lastNow ? Math.min((now - lastNow) / 1000, LONGEST_FRAME_SECONDS) : 1 / 60;
    lastNow = now;
    clock += isStill ? 0 : dt;
    if (step) {
      const share = isStill ? 1 : Math.min(1, (now - step.startMs) / STAGE_STEP_MS);
      const eased = easeStandard(share);
      travelled = step.fromTravelled + (step.toTravelled - step.fromTravelled) * eased;
      shownPaidOut = step.fromPaidOut + (step.toPaidOut - step.fromPaidOut) * eased;
      targetPaidOut = shownPaidOut;
      if (share >= 1) step = null;
    } else {
      const follow = isStill ? 1 : 1 - Math.exp(-dt / CHAIN_FOLLOW_SECONDS);
      shownPaidOut += (targetPaidOut - shownPaidOut) * follow;
      if (Math.abs(targetPaidOut - shownPaidOut) < 0.01) shownPaidOut = targetPaidOut;
    }
    const plumeTarget = anchor.isDug ? 1 : 0;
    settleLevel(plume, plumeTarget, dt, PLUME_SETTLE_SECONDS, isStill);
    draw();
    // The loop runs while anything moves; the silt keeps churning while the flukes are in the clay, unless the
    // reader asked for reduced motion.
    const isSettling = Math.abs(plume.level - plumeTarget) > 0.002;
    const isMoving = step !== null || shownPaidOut !== targetPaidOut || isSettling || (!isStill && plume.level > 0.002);
    frame = isRunning && isMoving ? requestAnimationFrame(tick) : 0;
  };

  const wake = () => {
    if (frame || !isRunning) return;
    lastNow = 0;
    frame = requestAnimationFrame(tick);
  };

  const goTo = (figureStage: FigureStage, isInstant: boolean) => {
    const moment = momentOf(figureStage);
    step = { fromTravelled: travelled, toTravelled: moment.travelledMetres, fromPaidOut: shownPaidOut, toPaidOut: moment.paidOutMetres, startMs: isInstant ? -Infinity : performance.now() };
    wake();
    return moment.paidOutMetres;
  };
  // The page's stage may already differ from the drawing's: go there at once, there is nothing to play from.
  goTo(input.figureStage, true);

  return {
    setStage: (figureStage) => goTo(figureStage, isStill),
    steer(paidOutMetres) {
      const clamped = Math.min(mostPaidOut, Math.max(leastPaidOut, paidOutMetres));
      // The reader's hand takes over from a step under way, where it stands.
      step = null;
      targetPaidOut = clamped;
      wake();
      return clamped;
    },
    readPaidOut: () => ({ shown: shownPaidOut, target: targetPaidOut }),
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
