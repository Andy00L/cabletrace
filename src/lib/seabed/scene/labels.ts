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

// Which label keeps its place when two overlap on screen: the lower rank wins, and between equal ranks the label made
// first. The vessel and the cuts are the story; a cable's name and a place name give way to them (Rubymar's three cut
// labels sit within 7 km; Minlianyu's name covered its cable's).
const STACKED_LABEL_RANK = 0;
const TONE_RANKS: Record<LabelTone, number> = { alarm: 1, ink: 2, cable: 3, pipeline: 3, muted: 4, land: 5 };
// Room kept between two labels' text (CSS px), about the width of their white halo.
const LABEL_GAP_PX = 2;

// The renderer centres the element on its point, so padding on one side moves the text off the point.
const PLACEMENT_CLASSES: Record<LabelPlacement, string> = {
  center: "",
  above: "pb-10",
  below: "pt-10",
};

export function makeLabel(text: string, tone: LabelTone, placement: LabelPlacement = "center"): CSS2DObject {
  const element = document.createElement("div");
  element.className = `map-label-halo whitespace-nowrap ${TONE_CLASSES[tone]} ${PLACEMENT_CLASSES[placement]}`;
  element.dataset.labelRank = String(TONE_RANKS[tone]);
  element.textContent = text;
  return new CSS2DObject(element);
}

/** A small ink ring pinned to a point: a position placed from statements, which a click opens. */
export function makePointMarker(): CSS2DObject {
  const element = document.createElement("div");
  element.className = "size-2.5 rounded-full border-2 border-ink bg-card";
  return new CSS2DObject(element);
}

/** A label whose muted note can change while the scene plays (the vessel's evidence and speed). */
export type StackedLabel = { object: CSS2DObject; setNote: (note: string) => void };

/** A bold title over a muted note, for objects whose nature must be stated ("illustrated", "reconstructed"). */
export function makeStackedLabel(title: string, note: string, placement: LabelPlacement = "center"): StackedLabel {
  const element = document.createElement("div");
  element.className = `map-label-halo flex flex-col items-center whitespace-nowrap ${PLACEMENT_CLASSES[placement]}`;
  element.dataset.labelRank = String(STACKED_LABEL_RANK);
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

function isOverlapping(first: DOMRect, second: DOMRect): boolean {
  return first.left < second.right + LABEL_GAP_PX && second.left < first.right + LABEL_GAP_PX && first.top < second.bottom + LABEL_GAP_PX && second.top < first.bottom + LABEL_GAP_PX;
}

/**
 * Hides each label whose text would overlap a label that outranks it, and shows it again once it is clear. Called
 * after every render of a label layer. The renderer hides labels behind the camera or switched off with
 * `display: none`; those are skipped, and this toggles `visibility` only, so the two never fight.
 */
export function hideOverlappingLabels(layer: HTMLElement) {
  const rankedLabels = [...layer.querySelectorAll<HTMLElement>("[data-label-rank]")]
    .filter((element) => element.style.display !== "none")
    .sort((first, second) => Number(first.dataset.labelRank) - Number(second.dataset.labelRank));
  const textRange = document.createRange();
  const shownRects: DOMRect[] = [];
  for (const element of rankedLabels) {
    // The text alone: a label's padding lifts it off its point and must not count as covering anything.
    textRange.selectNodeContents(element);
    const textRect = textRange.getBoundingClientRect();
    const isCovered = shownRects.some((shownRect) => isOverlapping(shownRect, textRect));
    element.style.visibility = isCovered ? "hidden" : "";
    if (!isCovered) shownRects.push(textRect);
  }
}
