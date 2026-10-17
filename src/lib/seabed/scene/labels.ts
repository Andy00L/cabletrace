import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// HTML labels pinned to points in the 3D scene. They use the app's type and color tokens; `map-label-halo`
// (src/app/globals.css) gives them the white halo every map label carries (docs/UI_DESIGN_SYSTEM.md, Data).

export type LabelTone = "muted" | "cable" | "pipeline" | "land" | "alarm" | "ink";

const TONE_CLASSES: Record<LabelTone, string> = {
  muted: "text-caption text-muted",
  cable: "text-caption font-semibold text-cable",
  pipeline: "text-caption font-semibold text-pipeline-text",
  land: "text-label font-semibold tracking-[0.02em] text-muted",
  alarm: "text-caption font-semibold text-alarm",
  ink: "text-caption font-semibold text-ink",
};

export function makeLabel(text: string, tone: LabelTone): CSS2DObject {
  const element = document.createElement("div");
  element.className = `map-label-halo whitespace-nowrap ${TONE_CLASSES[tone]}`;
  element.textContent = text;
  return new CSS2DObject(element);
}

/** A bold title over a muted note, for objects whose nature must be stated ("illustrated", "reconstructed"). */
export function makeStackedLabel(title: string, note: string): CSS2DObject {
  const element = document.createElement("div");
  element.className = "map-label-halo flex flex-col items-center whitespace-nowrap";
  const titleElement = document.createElement("strong");
  titleElement.className = "text-caption font-semibold text-ink";
  titleElement.textContent = title;
  const noteElement = document.createElement("span");
  noteElement.className = "text-micro text-muted";
  noteElement.textContent = note;
  element.append(titleElement, noteElement);
  return new CSS2DObject(element);
}
