import type { ReplaySceneInput } from "@/lib/replay/replay-scene";

// The director's shot list (round-2 storyboard, board 21, approved by Andy): every case replay is told in five kinds
// of shot, derived from its track, its drag window and its cuts, so a new case gets its camera without any tuning.
//   establishing  the gulf, the cables and the whole route, until the ship's first known position
//   follow        the ship under way, its chain and the anchor on the seabed in one frame
//   approach      the anchor and the cable it is closing on, from low over the seabed
//   cut           the close-up at the cut, a slow orbit around the torn ends
//   aftermath     pulled back over the whole track and every cut
// The replay time picks the shot (pickShotAt); framing.ts turns a shot into a camera.

/** How long before a cut the approach starts, and how long the close-up holds after it (Andy's approval, 20 Oct 2026). */
export const APPROACH_LEAD_MS = 6 * 60_000;
export const CUT_HOLD_MS = 2 * 60_000;

/** The views the director cuts between; the overview scene's views take a framed camera, the close-up its own. */
export type DirectorView = "overview" | "top" | "vessel" | "closeup";

type ShotSpan = { startMs: number; endMs: number };

export type Shot =
  | (ShotSpan & { kind: "establishing" })
  | (ShotSpan & { kind: "follow" })
  | (ShotSpan & { kind: "approach"; cutIndex: number })
  | (ShotSpan & { kind: "cut"; cutIndex: number })
  | (ShotSpan & { kind: "aftermath" });

export type ShotKind = Shot["kind"];

/** Shots in time order, each starting where the previous one ends, covering the whole replay window. */
export type ShotList = readonly [Shot, ...Shot[]];

export type DirectorCaseInput = Pick<ReplaySceneInput, "windowStartMs" | "windowEndMs" | "track" | "cuts" | "dragWindow">;

function clampToWindow(atMs: number, input: DirectorCaseInput): number {
  return Math.min(input.windowEndMs, Math.max(input.windowStartMs, atMs));
}

/**
 * The shot list of a case. The establishing shot runs to the ship's first known position (Eagle S: 10:26, where it
 * stands over Estlink 2). A cut gets its approach and its close-up only when the ship is on the map for the whole
 * approach before it: a cut at the first position (Estlink 2) happens inside the establishing shot. Between cuts the
 * camera follows the ship; after the last close-up it pulls back for the aftermath. Without a close-up, it follows the
 * ship to the end of the drag (or of the track) and then pulls back.
 */
export function buildShotList(input: DirectorCaseInput): ShotList {
  const { windowStartMs, windowEndMs } = input;
  const firstPositionMs = clampToWindow(input.track[0]?.atMs ?? windowStartMs, input);
  const shots: Shot[] = [{ kind: "establishing", startMs: windowStartMs, endMs: firstPositionMs }];
  let cursorMs = firstPositionMs;
  let hasCloseUp = false;
  const cutsInOrder = input.cuts.map((cut, cutIndex) => ({ atMs: cut.atMs, cutIndex })).sort((first, second) => first.atMs - second.atMs);
  for (const cut of cutsInOrder) {
    const approachStartMs = cut.atMs - APPROACH_LEAD_MS;
    // The ship must be on the map for the whole approach, and the previous close-up must be over.
    if (approachStartMs < firstPositionMs || approachStartMs < cursorMs || cut.atMs >= windowEndMs) continue;
    if (approachStartMs > cursorMs) shots.push({ kind: "follow", startMs: cursorMs, endMs: approachStartMs });
    const holdEndMs = Math.min(windowEndMs, cut.atMs + CUT_HOLD_MS);
    shots.push({ kind: "approach", cutIndex: cut.cutIndex, startMs: approachStartMs, endMs: cut.atMs });
    shots.push({ kind: "cut", cutIndex: cut.cutIndex, startMs: cut.atMs, endMs: holdEndMs });
    cursorMs = holdEndMs;
    hasCloseUp = true;
  }
  if (!hasCloseUp) {
    const lastPositionMs = input.track[input.track.length - 1]?.atMs ?? cursorMs;
    const followEndMs = clampToWindow(Math.max(input.dragWindow?.endMs ?? lastPositionMs, cursorMs), input);
    if (followEndMs > cursorMs) shots.push({ kind: "follow", startMs: cursorMs, endMs: followEndMs });
    cursorMs = Math.max(cursorMs, followEndMs);
  }
  if (windowEndMs > cursorMs) shots.push({ kind: "aftermath", startMs: cursorMs, endMs: windowEndMs });
  // A window that opens on the first position (or after it) leaves the establishing shot one instant long: it is kept,
  // so the replay's opening frame is still the establishing view (pickShotAt keeps its last instant). Other empty
  // shots go.
  const [establishingShot, ...laterShots] = shots;
  const keptLaterShots = laterShots.filter((shot) => shot.endMs > shot.startMs);
  return establishingShot ? [establishingShot, ...keptLaterShots] : [{ kind: "establishing", startMs: windowStartMs, endMs: windowEndMs }];
}

/**
 * The shot on screen at a replay moment. Shots cover [start, end), except that the establishing shot keeps its last
 * instant (the replay opens on the ship's first position, and that first frame is the establishing view with the
 * ship in it) and the last shot keeps the window's end. Moments outside the window take the nearest shot.
 */
export function pickShotAt(shots: ShotList, atMs: number): Shot {
  const lastShot = shots[shots.length - 1] ?? shots[0];
  for (const shot of shots) {
    const keepsEnd = shot.kind === "establishing" || shot === lastShot;
    if (atMs < shot.endMs || (keepsEnd && atMs <= shot.endMs)) return shot;
  }
  return lastShot;
}

/** The view a shot is drawn in: its framed camera goes on the overview scene, except the cut's close-up. */
export function readShotView(shot: Shot): DirectorView {
  switch (shot.kind) {
    case "establishing":
      return "overview";
    case "follow":
    case "approach":
      return "vessel";
    case "cut":
      return "closeup";
    case "aftermath":
      return "top";
    default: {
      const unhandledShot: never = shot;
      return unhandledShot;
    }
  }
}

/** True when both name the same shot of a list: shots are compared by kind and span, so a rebuilt list matches. */
export function isSameShot(first: Shot, second: Shot): boolean {
  return first.kind === second.kind && first.startMs === second.startMs && first.endMs === second.endMs;
}
