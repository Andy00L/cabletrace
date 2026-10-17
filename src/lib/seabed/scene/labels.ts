import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// HTML labels pinned to points in the 3D scene. They use the app's type and color tokens; `map-label-halo`
// (src/app/globals.css) gives them the white halo every map label carries (docs/UI_DESIGN_SYSTEM.md, Data).

export type LabelTone = "muted" | "cable" | "pipeline" | "land" | "alarm" | "ink";
/** Where the text sits relative to its point: centred on it, or lifted above or dropped below it by 20px. */
export type LabelPlacement = "center" | "above" | "below";

const TONE_CLASSES: Record<LabelTone, string> = {
  muted: "text-caption text-muted",
  cable: "text-caption font-semibold text-cable",
  pipeline: "text-caption font-semibold text-pipeline-text",
  land: "text-label font-semibold tracking-[0.02em] text-muted",
  alarm: "text-caption font-semibold text-alarm",
  ink: "text-caption font-semibold text-ink",
};

// The renderer centres the element on its point, so padding on one side moves the text off the point.
const PLACEMENT_CLASSES: Record<LabelPlacement, string> = {
  center: "",
  above: "pb-10",
  below: "pt-10",
};

export function makeLabel(text: string, tone: LabelTone, placement: LabelPlacement = "center"): CSS2DObject {
  const element = document.createElement("div");
  element.className = `map-label-halo whitespace-nowrap ${TONE_CLASSES[tone]} ${PLACEMENT_CLASSES[placement]}`;
  element.textContent = text;
  return new CSS2DObject(element);
}

/** A label whose muted note can change while the scene plays (the vessel's evidence and speed). */
export type StackedLabel = { object: CSS2DObject; setNote: (note: string) => void };

/** A bold title over a muted note, for objects whose nature must be stated ("illustrated", "reconstructed"). */
export function makeStackedLabel(title: string, note: string, placement: LabelPlacement = "center"): StackedLabel {
  const element = document.createElement("div");
  element.className = `map-label-halo flex flex-col items-center whitespace-nowrap ${PLACEMENT_CLASSES[placement]}`;
  const titleElement = document.createElement("strong");
  titleElement.className = "text-caption font-semibold text-ink";
  titleElement.textContent = title;
  const noteElement = document.createElement("span");
  noteElement.className = "text-micro text-muted";
  noteElement.textContent = note;
  element.append(titleElement, noteElement);
  return {
    object: new CSS2DObject(element),
    // Called every frame by the overview, so the DOM is touched only when the text changes.
    setNote: (nextNote: string) => {
      if (noteElement.textContent !== nextNote) noteElement.textContent = nextNote;
    },
  };
}
