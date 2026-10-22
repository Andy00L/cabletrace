import { iso, type Flat } from "@/components/iso/iso-kit";
import {
  alongTransform,
  buildAnchorArt,
  buildCableArt,
  buildChainArt,
  buildFurrowArt,
  buildRestingFrame,
  slideTransform,
  type AnchorArt,
  type FurrowRun,
} from "@/components/landing/anchor-figure-frame";
import { paintParts, type Part } from "@/components/landing/anchor-figure-parts";
import { buildPlumeStipple } from "@/components/landing/anchor-figure-plume";
import { buildStaticScene } from "@/components/landing/anchor-figure-scene";
import { BLOCK, VIEW_HEIGHT, VIEW_WIDTH, type FigureView } from "@/components/landing/anchor-figure-view";
import type { AnchorFigureFacts, CableState, ChainReading } from "@/lib/landing/anchor-figure-model";

// The anchor figure as one SVG document: every static part painted far to near, and the moving parts (chain, anchor,
// furrow, cables) in named slots filled with the resting frame. The front page fetches it from its own route
// (src/app/figures/anchor-figure.svg/route.ts) once the figure nears the view and moves its two layers into the stage,
// so none of its paths ride in the page's HTML or its React payload. The live engine rewrites the slots' contents
// with the same builders (buildChainSlots, buildSeabedSlots), so the first frame it draws changes nothing.

/** The slots the engine rewrites, by the `data-slot` each carries. */
export const CHAIN_SLOTS = ["chain-behind", "chain-front", "chain-above"] as const;
export const SEABED_SLOTS = ["furrow-back", "furrow-front", "anchor", "cuts"] as const;
export type ChainSlot = (typeof CHAIN_SLOTS)[number];
export type SeabedSlot = (typeof SEABED_SLOTS)[number];

/** The chain and the anchor for one reading: what changes only when the chain paid out changes. */
export function buildChainSlots(view: FigureView, reading: ChainReading): { slots: Record<ChainSlot, string>; anchor: AnchorArt } {
  const chain = buildChainArt(view, reading);
  const anchor = buildAnchorArt(view, reading);
  return { slots: { "chain-behind": chain.behindHull, "chain-front": chain.front, "chain-above": chain.aboveWater }, anchor };
}

/**
 * The seabed's moving parts for a moment: the furrow, and the anchor painted far to near together with the spoil
 * ahead of its flukes and the cables, so a cable caught on a fluke passes in front of it and behind it where it should.
 */
export function buildSeabedSlots(view: FigureView, moment: { travelled: number; runs: readonly FurrowRun[]; cables: readonly CableState[]; anchor: AnchorArt }): Record<SeabedSlot, string> {
  const { travelled, runs, cables, anchor } = moment;
  const furrow = buildFurrowArt(view, runs, travelled, anchor.isDug ? anchor.flukeTip : null);
  const cableArts = cables.map((cable) => buildCableArt(view, cable, travelled, anchor.hook));
  return {
    "furrow-back": furrow.back,
    "furrow-front": furrow.front,
    anchor: paintParts([...anchor.parts, ...furrow.spoilParts, ...cableArts.flatMap((art) => art.parts)], view.projection),
    cuts: cableArts.map((art) => art.cut).join(""),
  };
}

const slot = (name: string, content: string, attributes = "") => `<g data-slot="${name}"${attributes}>${content}</g>`;
const paint = (parts: readonly Part[], view: FigureView) => paintParts(parts, view.projection);

/** The water's tint: the block's box of water, deeper toward the seabed, behind everything in it. */
function waterTint(view: FigureView, waterClip: string): string {
  const surface: Flat = iso([BLOCK.x + BLOCK.w, BLOCK.y, view.depth], view.projection);
  const seabed: Flat = iso([BLOCK.x + BLOCK.w, BLOCK.y + BLOCK.d, 0], view.projection);
  return [
    `<linearGradient id="af-water-depth" gradientUnits="userSpaceOnUse" x1="0" y1="${surface[1].toFixed(1)}" x2="0" y2="${seabed[1].toFixed(1)}">`,
    `<stop offset="0" class="af-water-stop-surface"/><stop offset="1" class="af-water-stop-seabed"/></linearGradient>`,
    `<path class="af-water" d="${waterClip}" fill="url(#af-water-depth)"/>`,
  ].join("");
}

/** The whole figure as an SVG document: a back layer under the silt canvas and a front layer over it. */
export function buildFigureSvg(facts: AnchorFigureFacts, view: FigureView): string {
  const scene = buildStaticScene(view);
  const resting = buildRestingFrame(facts, view);
  const chain = buildChainSlots(view, resting.reading);
  const seabed = buildSeabedSlots(view, { travelled: resting.moment.travelledMetres, runs: resting.runs, cables: resting.cables, anchor: chain.anchor });
  const { layers } = scene;
  const stipple = buildPlumeStipple(view)
    .map(([screenX, screenY, alpha]) => `<circle cx="${screenX.toFixed(1)}" cy="${screenY.toFixed(1)}" r="0.42" fill-opacity="${alpha}"/>`)
    .join("");
  const fade = scene.fadeFrom;
  const fadeTo = scene.fadeTo;
  const back = [
    "<defs>",
    `<clipPath id="af-seabed-clip"><path d="${scene.seabedClip}"/></clipPath>`,
    `<clipPath id="af-water-clip"><path d="${scene.waterClip}"/></clipPath>`,
    `<linearGradient id="af-seabed-fade-ramp" gradientUnits="userSpaceOnUse" x1="${fade[0].toFixed(1)}" y1="${fade[1].toFixed(1)}" x2="${fadeTo[0].toFixed(1)}" y2="${fadeTo[1].toFixed(1)}">`,
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.05" stop-color="#fff" stop-opacity="1"/><stop offset="0.97" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>`,
    "</linearGradient>",
    `<mask id="af-seabed-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}"><rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="url(#af-seabed-fade-ramp)"/></mask>`,
    "</defs>",
    // Never painted: it carries the silt token, which the shader reads for its ink.
    `<path class="af-silt-probe" d="M0 0"/>`,
    paint(layers.block, view),
    waterTint(view, scene.waterClip),
    `<g clip-path="url(#af-seabed-clip)">`,
    `<g mask="url(#af-seabed-fade)">`,
    slot("slide", paint(layers.texture, view), ` transform="${slideTransform(view, resting.moment.travelledMetres, scene.texturePeriod)}"`),
    slot("furrow-back", seabed["furrow-back"]),
    slot("furrow-front", seabed["furrow-front"]),
    "</g>",
    "</g>",
    `<g clip-path="url(#af-water-clip)">`,
    slot("stipple", `<g class="iso-dots" data-tone="lo">${stipple}</g>`, ` class="af-plume-fallback" transform="${alongTransform(view, chain.anchor.flukeTip[0])}"`),
    "</g>",
    paint(layers.waterBack, view),
  ].join("");
  const front = [
    slot("chain-behind", chain.slots["chain-behind"]),
    paint(layers.hullUnder, view),
    slot("anchor", seabed.anchor),
    slot("cuts", seabed.cuts),
    slot("chain-front", chain.slots["chain-front"]),
    paint(layers.surface, view),
    paint(layers.above, view),
    slot("chain-above", chain.slots["chain-above"]),
    paint(layers.front, view),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"><g data-layer="back">${back}</g><g data-layer="front">${front}</g></svg>`;
}
