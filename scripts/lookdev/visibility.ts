// The visibility check's judge (ui-console-2, 6: "subjects visible"): every subject a director shot promises sits inside
// the shot's safe area and the relief does not hide it. Pure, so the rule is tested apart from the browser run
// (visibility-check.ts). The moments: the start of each case's drag, each cut and the end of the drag.

/** A subject as the viewer's lookdev hook reports it (viewer.ts, data-subjects): canvas CSS px, null behind the camera. */
export type ReportedSubject = { name: string; x: number | null; y: number | null; isHidden: boolean };
export type SafeAreaBox = { left: number; top: number; right: number; bottom: number };

export type SubjectVerdict = { name: string; result: "visible" | "outside" | "hidden" | "missing" };

/** One verdict per promised subject, in the promised order. */
export function judgeSubjects(promised: readonly string[], reported: readonly ReportedSubject[], safeArea: SafeAreaBox): SubjectVerdict[] {
  return promised.map((name) => {
    const subject = reported.find((candidate) => candidate.name === name);
    if (!subject) return { name, result: "missing" };
    const { x, y } = subject;
    if (x === null || y === null || x < safeArea.left || x > safeArea.right || y < safeArea.top || y > safeArea.bottom) return { name, result: "outside" };
    return { name, result: subject.isHidden ? "hidden" : "visible" };
  });
}

// Every case drags from its first position, where the director holds the establishing shot (the ship, not yet its
// anchor), and the cut minute is the close-up (the anchor and the torn ends, no ship): two more moments put the ship with
// its anchor (follow, just after the drag starts) and the anchor with the cut point (the approach, before each cut) to
// the test.
const MINUTE_MS = 60_000;
const FOLLOW_AFTER_DRAG_START_MS = 2 * MINUTE_MS;
const APPROACH_BEFORE_CUT_MS = 3 * MINUTE_MS;

/**
 * The check's moments for a case (ms, whole minutes, inside the window, in order, once each): the drag's start and a
 * moment just after it, each cut and a moment of its approach, and the drag's end.
 */
export function listCheckMoments(input: { windowStartMs: number; windowEndMs: number; dragWindow: { startMs: number; endMs: number } | null; cuts: readonly { atMs: number }[] }): number[] {
  const dragMoments = input.dragWindow ? [input.dragWindow.startMs, input.dragWindow.startMs + FOLLOW_AFTER_DRAG_START_MS, input.dragWindow.endMs] : [];
  const cutMoments = input.cuts.flatMap((cut) => [cut.atMs - APPROACH_BEFORE_CUT_MS, cut.atMs]);
  const moments = [...dragMoments, ...cutMoments].map((atMs) => Math.floor(Math.min(input.windowEndMs, Math.max(input.windowStartMs, atMs)) / MINUTE_MS) * MINUTE_MS);
  return [...new Set(moments)].sort((first, second) => first - second);
}

/** Parses the hook's JSON (unknown) into subjects, dropping malformed entries. */
export function parseReportedSubjects(text: string): ReportedSubject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown): ReportedSubject[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const name: unknown = Reflect.get(entry, "name");
    const pointX: unknown = Reflect.get(entry, "x");
    const pointY: unknown = Reflect.get(entry, "y");
    const isHidden: unknown = Reflect.get(entry, "isHidden");
    if (typeof name !== "string" || typeof isHidden !== "boolean") return [];
    return [{ name, x: typeof pointX === "number" ? pointX : null, y: typeof pointY === "number" ? pointY : null, isHidden }];
  });
}

/** Parses the hook's safe area (unknown); null when malformed. */
export function parseSafeArea(text: string): SafeAreaBox | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const sides = ["left", "top", "right", "bottom"].map((side) => Reflect.get(parsed, side));
  const [left, top, right, bottom] = sides;
  return typeof left === "number" && typeof top === "number" && typeof right === "number" && typeof bottom === "number" ? { left, top, right, bottom } : null;
}

/** Parses the hook's promised subject names (unknown); empty when malformed. */
export function parseNames(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}
