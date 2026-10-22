import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";

// The front page's footage of the real console: a time-lapse of the Eagle S replay and three stills, rendered by
// scripts/landing-footage/ (`bun run footage`, docs/LOOKDEV.md, Landing footage) into public/landing/. This module is
// the footage's single description: the script reads it to know what to render, the page reads it to know what it
// shows. Video and still sizes are in px; every path is a site path under public/.

/** The video's two cuts. Both show the 3D scene with the console's own stage overlays (labels, status pill, anchor cam). */
export type FootageCrop = "desktop" | "phone";
export type FootageFile = { mp4: string; webm: string; posterAvif: string; posterWebp: string; width: number; height: number };
/** A case event inside the time-lapse, and the video time of the first frame that shows its moment. */
export type FootageEvent = { atMs: number; title: string; videoSeconds: number };
export type ReplayFootage = {
  caseSlug: string;
  /** The whole video, the held end included. */
  durationSeconds: number;
  /** The replay window the time-lapse covers (ms since epoch) and the held end at its last frame. */
  replayStartMs: number;
  replayEndMs: number;
  holdSeconds: number;
  /** Frames per second of every video. */
  framesPerSecond: number;
  files: Readonly<Record<FootageCrop, FootageFile>>;
  events: readonly FootageEvent[];
};

export type ConsoleStillName = "vessel" | "closeup" | "globe";
/** A still of the console at 2x; `width` and `height` are the largest file's, `widths` every width written. */
export type ConsoleStill = { name: ConsoleStillName; width: number; height: number; widths: readonly number[]; alt: string };

const FOOTAGE_FOLDER = "/landing/footage";
const STILLS_FOLDER = "/landing/stills";
// The time-lapse runs 10:00 to 17:00 UTC: the case window opens at 10:00 (the case file), the drag runs 10:26 to
// 16:45 and the end holds on 17:00, a quarter of an hour after the last cut (C-Lion1, 16:44).
const REPLAY_END_UTC = "2024-12-25T17:00:00Z";
// 20 s of time-lapse (21 replay minutes a second) and 1.5 s held on its last frame, at 30 frames a second.
const LAPSE_SECONDS = 20;
const HOLD_SECONDS = 1.5;
const FRAMES_PER_SECOND = 30;
// Desktop 16:10 and phone 4:5. The phone crop is 1,124 px tall, not 1,125: 4:2:0 video (H.264 and AV1 as browsers
// play them) needs an even height, and 900 x 1,124 differs from 4:5 by one pixel.
const CROP_SIZES: Readonly<Record<FootageCrop, { width: number; height: number }>> = {
  desktop: { width: 1600, height: 1000 },
  phone: { width: 900, height: 1124 },
};

function describeFootageFile(crop: FootageCrop): FootageFile {
  const baseName = `${FOOTAGE_FOLDER}/${EAGLE_S_2024.slug}-${crop}`;
  return { mp4: `${baseName}.mp4`, webm: `${baseName}.webm`, posterAvif: `${baseName}-poster.avif`, posterWebp: `${baseName}-poster.webp`, ...CROP_SIZES[crop] };
}

/** What the time mapping reads of the footage. */
type FootageTiming = Pick<ReplayFootage, "durationSeconds" | "holdSeconds" | "replayStartMs" | "replayEndMs">;

/** Video seconds at a replay moment: 0 up to the window's start, the start of the held end from its last moment on. */
export function findVideoSecondsForReplayTime(footage: FootageTiming, atMs: number): number {
  const lapseSeconds = footage.durationSeconds - footage.holdSeconds;
  const spanMs = footage.replayEndMs - footage.replayStartMs;
  if (!Number.isFinite(atMs) || atMs <= footage.replayStartMs || spanMs <= 0) return 0;
  if (atMs >= footage.replayEndMs) return lapseSeconds;
  return ((atMs - footage.replayStartMs) / spanMs) * lapseSeconds;
}

/** The replay moment a video time shows: the window's start before 0, its end through the held end and past it. */
export function findReplayTimeForVideoSeconds(footage: FootageTiming, videoSeconds: number): number {
  const lapseSeconds = footage.durationSeconds - footage.holdSeconds;
  if (!Number.isFinite(videoSeconds) || videoSeconds <= 0 || lapseSeconds <= 0) return footage.replayStartMs;
  if (videoSeconds >= lapseSeconds) return footage.replayEndMs;
  return footage.replayStartMs + (videoSeconds / lapseSeconds) * (footage.replayEndMs - footage.replayStartMs);
}

/** The footage's events: the case file's events inside the replay window, each with its video time. */
function listFootageEvents(timing: FootageTiming): FootageEvent[] {
  return EAGLE_S_2024.events
    .map((event) => ({ atMs: Date.parse(event.atUtc), title: event.title }))
    .filter((event) => event.atMs >= timing.replayStartMs && event.atMs <= timing.replayEndMs)
    .map((event) => ({ ...event, videoSeconds: findVideoSecondsForReplayTime(timing, event.atMs) }));
}

const FOOTAGE_FILES: ReplayFootage["files"] = {
  desktop: describeFootageFile("desktop"),
  phone: describeFootageFile("phone"),
};

const FOOTAGE_TIMING: FootageTiming = {
  durationSeconds: LAPSE_SECONDS + HOLD_SECONDS,
  holdSeconds: HOLD_SECONDS,
  replayStartMs: Date.parse(EAGLE_S_2024.window.startUtc),
  replayEndMs: Date.parse(REPLAY_END_UTC),
};

/** The Eagle S time-lapse, 25 Dec 2024, 10:00 to 17:00 UTC, in two crops. */
export const EAGLE_S_FOOTAGE: ReplayFootage = {
  caseSlug: EAGLE_S_2024.slug,
  ...FOOTAGE_TIMING,
  framesPerSecond: FRAMES_PER_SECOND,
  files: FOOTAGE_FILES,
  events: listFootageEvents(FOOTAGE_TIMING),
};

/** Where a still is served at one width and format. */
export function findConsoleStillPath(name: ConsoleStillName, width: number, format: "avif" | "webp"): string {
  return `${STILLS_FOLDER}/${name}-${width}.${format}`;
}

// The stills are taken at 1,200 x 750 CSS px and a device pixel ratio of 2.
const STILL_WIDTHS = [1600, 2400] as const;
const STILL_SIZE = { width: 2400, height: 1500 };

export const CONSOLE_STILLS: Readonly<Record<ConsoleStillName, ConsoleStill>> = {
  vessel: {
    name: "vessel",
    ...STILL_SIZE,
    widths: STILL_WIDTHS,
    alt: "The console's Vessel view: the tanker Eagle S crosses the Gulf of Finland with its chain running down to the anchor, which ploughs a red furrow across the seabed between cables and pipelines; the anchor cam window shows the anchor on the bottom with its depth, chain and speed.",
  },
  closeup: {
    name: "closeup",
    ...STILL_SIZE,
    widths: STILL_WIDTHS,
    alt: "The console's close-up at the cut: the Estlink 2 power cable lies torn apart on the sand, its armour wires and conductors splayed under a red Cut label, while the dragged anchor and its chain move on past it.",
  },
  globe: {
    name: "globe",
    ...STILL_SIZE,
    widths: STILL_WIDTHS,
    alt: "The live globe of a recorded day: ships counted per sea over Europe, the North Atlantic and the Middle East, the world's cables and pipelines, and hatching over every sea no coastal feed hears.",
  },
};
