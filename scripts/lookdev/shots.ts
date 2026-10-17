import { CABLE_CASES } from "../../src/data/cases";
import { toReplaySceneInput } from "../../src/lib/cases/case-file";
import { formatMinute } from "../../src/lib/console/console-state";
import type { DataTone } from "../../src/lib/seabed/scene/overview";
import type { SeabedViewName } from "../../src/lib/seabed/scene/viewer";

// The fixed frames the lookdev harness renders. Each opens a case page through its URL state (?t=&view=, the codec in
// src/lib/console/console-state.ts) at the minute of the case's last cut, or the middle of the drag window when the
// cut comes earlier (Vezhen's only cut is at its first position), and never after the window ends: the cuts have
// happened, a long stretch of track is drawn and the anchor is still down. Every case gets the overview (the whole
// story) and the vessel view (its hull, chain and anchor up close); Eagle S, the case the console opens on, also gets
// the view from above, the close-up, and an overview after the drag, the one frame where the track is drawn in ink
// (every case drags from its first position, so until the drag ends the whole track is alarm).

export type LookdevShot = {
  /** File name of the frame and of its baseline. */
  name: string;
  caseSlug: string;
  view: SeabedViewName;
  atMs: number;
  /** Data tones this frame must show (and pass); others are checked when they happen to be on screen. */
  requiredTones: DataTone[];
};

const HERO_CASE_SLUG = "eagle-s-2024";
const HERO_EXTRA_VIEWS: readonly SeabedViewName[] = ["top", "closeup"];
// The hero's after-drag frame: this long after the drag window ends (ms), when the ink track is long enough to probe.
const AFTER_DRAG_MS = 3 * 60 * 60 * 1000;

/** A moment as the URL carries it: rounded down to its minute. */
function toWholeMinute(atMs: number): number {
  return Date.parse(formatMinute(atMs).replace("Z", ":00Z"));
}

/** The shots for every published case, in a stable order. */
export function listLookdevShots(): LookdevShot[] {
  return CABLE_CASES.flatMap((cableCase) => {
    const input = toReplaySceneInput(cableCase);
    const lastCutMs = Math.max(...input.cuts.map((cut) => cut.atMs));
    const dragMiddleMs = input.dragWindow ? (input.dragWindow.startMs + input.dragWindow.endMs) / 2 : lastCutMs;
    const atMs = toWholeMinute(input.dragWindow ? Math.min(Math.max(lastCutMs, dragMiddleMs), input.dragWindow.endMs) : lastCutMs);
    const isHero = cableCase.slug === HERO_CASE_SLUG;
    const views: SeabedViewName[] = ["overview", "vessel", ...(isHero ? HERO_EXTRA_VIEWS : [])];
    const shots: LookdevShot[] = views.map((view) => ({
      name: `${cableCase.slug}-${view}`,
      caseSlug: cableCase.slug,
      view,
      atMs,
      requiredTones: view === "overview" ? ["cable", "alarm"] : [],
    }));
    if (isHero && input.dragWindow) {
      const lastPositionMs = input.track[input.track.length - 1]?.atMs ?? input.dragWindow.endMs;
      const requiredTones: DataTone[] = ["cable", "suspect", "alarm"];
      shots.push({ name: `${cableCase.slug}-after-drag`, caseSlug: cableCase.slug, view: "overview", atMs: toWholeMinute(Math.min(input.dragWindow.endMs + AFTER_DRAG_MS, lastPositionMs)), requiredTones });
    }
    return shots;
  });
}
