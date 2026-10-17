// Where the ship frames live in Supabase Storage and how the browser finds them.
//
//   bucket ship-frames (public read)
//     index.json                        every stored frame (at most 47 hours), rewritten by every collector run
//     frames/20261017T1420Z.bin.gz      one gzip-compressed frame (snapshot-codec.ts) per 10-minute UTC slot
//
// Browser: GET {projectUrl}/storage/v1/object/public/ship-frames/index.json, parseFrameIndex, keep
// selectLiveFrames (the last 24 hours), fetch the last entry first (the newest frame) and the rest on
// demand; gunzipBytes then decodeShipFrame per file.
// The index is also the collector's own record of what is stored, so a run reads one small file
// instead of listing the bucket (a listing costs about 400 bytes of egress per object).
// Type-only import: see the import rule at the top of snapshot-codec.ts.
import type { Result } from "../result.ts";
import type { ShipSource } from "./snapshot-codec.ts";

export const FRAME_BUCKET = "ship-frames";
export const FRAME_INDEX_PATH = "index.json";
export const FRAMES_FOLDER = "frames";
export const FRAME_INDEX_VERSION = 1;
export const SLOT_MINUTES = 10;
export const SLOT_MS = SLOT_MINUTES * 60_000;
// The /live page shows one day.
export const LIVE_WINDOW_MS = 24 * 60 * 60_000;
// aisstream.io data may be kept at most 2 days (owner's rule, 2026-10-17). A frame holds reports up
// to CARRY_FORWARD_MS (30 minutes, ship-merge.ts) older than its slot, so frames go after 47 hours.
export const FRAME_RETENTION_MS = 47 * 60 * 60_000;

// Credits to show wherever positions are drawn, per source of each ship (source flag in the frame).
export const SOURCE_CREDITS: Readonly<Record<ShipSource, string>> = {
  aisstream: "aisstream.io",
  digitraffic: "Fintraffic / digitraffic.fi",
};

export type FrameIndexEntry = { path: string; slotStartMs: number; bytes: number };
export type FrameIndex = {
  version: number;
  generatedAtMs: number;
  slotMinutes: number;
  // Every stored frame, oldest first; the last entry is the newest frame (its slot may still be filling).
  frames: FrameIndexEntry[];
  credits: string[];
};

export type StoredFrame = { slotStartMs: number; bytes: number };

const FRAME_NAME_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z\.bin\.gz$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function slotStartMs(timeMs: number): number {
  return Math.floor(timeMs / SLOT_MS) * SLOT_MS;
}

/** File name of a slot's frame, "20261017T1420Z.bin.gz" (UTC slot start), sortable as text. */
export function frameObjectName(slotStart: number): string {
  const slotDate = new Date(slotStart);
  return (
    `${padNumber(slotDate.getUTCFullYear(), 4)}${padNumber(slotDate.getUTCMonth() + 1, 2)}${padNumber(slotDate.getUTCDate(), 2)}` +
    `T${padNumber(slotDate.getUTCHours(), 2)}${padNumber(slotDate.getUTCMinutes(), 2)}Z.bin.gz`
  );
}

export function frameObjectPath(slotStart: number): string {
  return `${FRAMES_FOLDER}/${frameObjectName(slotStart)}`;
}

/** Reads the slot start back from a frame file name; anything else in the folder is rejected. */
export function parseFrameObjectName(name: string): Result<number> {
  const match = FRAME_NAME_PATTERN.exec(name);
  if (match === null) return { ok: false, reason: `${name} is not a frame file name` };
  const [, year, month, day, hour, minute] = match;
  const slotStart = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (frameObjectName(slotStart) !== name || slotStart % SLOT_MS !== 0) return { ok: false, reason: `${name} is not a slot start` };
  return { ok: true, value: slotStart };
}

/** Public URL of an object in the frame bucket, fetched by the browser without any key. */
export function frameObjectUrl(projectUrl: string, objectPath: string): string {
  return `${projectUrl.replace(/\/+$/u, "")}/storage/v1/object/public/${FRAME_BUCKET}/${objectPath}`;
}

/** Stored frames past the retention window, which the collector deletes. */
export function selectExpiredFrames(frames: readonly StoredFrame[], nowMs: number): StoredFrame[] {
  return frames.filter((frame) => frame.slotStartMs < nowMs - FRAME_RETENTION_MS);
}

/** Builds index.json from the stored frames, oldest first, one entry per slot. */
export function buildFrameIndex(frames: readonly StoredFrame[], generatedAtMs: number): FrameIndex {
  const bySlot = new Map<number, StoredFrame>();
  for (const frame of frames) {
    if (frame.slotStartMs <= generatedAtMs) bySlot.set(frame.slotStartMs, frame);
  }
  return {
    version: FRAME_INDEX_VERSION,
    generatedAtMs,
    slotMinutes: SLOT_MINUTES,
    frames: [...bySlot.values()]
      .sort((first, second) => first.slotStartMs - second.slotStartMs)
      .map((frame) => ({ path: frameObjectPath(frame.slotStartMs), slotStartMs: frame.slotStartMs, bytes: frame.bytes })),
    credits: Object.values(SOURCE_CREDITS),
  };
}

/** The entries the /live page shows: the slots of the 24 hours before the index was written. */
export function selectLiveFrames(frameIndex: FrameIndex): FrameIndexEntry[] {
  const oldestSlotMs = slotStartMs(frameIndex.generatedAtMs - LIVE_WINDOW_MS);
  return frameIndex.frames.filter((entry) => entry.slotStartMs >= oldestSlotMs);
}

function parseIndexEntry(entry: unknown): FrameIndexEntry | null {
  if (!isRecord(entry)) return null;
  const { path, slotStartMs: slotStart, bytes } = entry;
  if (typeof path !== "string" || typeof slotStart !== "number" || typeof bytes !== "number") return null;
  if (!Number.isInteger(slotStart) || slotStart % SLOT_MS !== 0 || path !== frameObjectPath(slotStart)) return null;
  if (!Number.isInteger(bytes) || bytes <= 0) return null;
  return { path, slotStartMs: slotStart, bytes };
}

/** Validates index.json as downloaded by the browser. */
export function parseFrameIndex(payload: unknown): Result<FrameIndex> {
  if (!isRecord(payload)) return { ok: false, reason: "frame index is not an object" };
  if (payload.version !== FRAME_INDEX_VERSION) return { ok: false, reason: `frame index version ${String(payload.version)} is not supported` };
  const { generatedAtMs, slotMinutes, frames, credits } = payload;
  if (typeof generatedAtMs !== "number" || !Number.isFinite(generatedAtMs)) return { ok: false, reason: "frame index has no generation time" };
  if (slotMinutes !== SLOT_MINUTES) return { ok: false, reason: `frame index slot of ${String(slotMinutes)} minutes is not supported` };
  if (!Array.isArray(frames) || !Array.isArray(credits)) return { ok: false, reason: "frame index has no frame list" };
  const entries: FrameIndexEntry[] = [];
  for (const entry of frames) {
    const parsed = parseIndexEntry(entry);
    if (parsed === null) return { ok: false, reason: "frame index has a malformed entry" };
    const previous = entries.at(-1);
    if (previous !== undefined && parsed.slotStartMs <= previous.slotStartMs) return { ok: false, reason: "frame index is not in slot order" };
    entries.push(parsed);
  }
  const creditLines = credits.filter((credit): credit is string => typeof credit === "string");
  return { ok: true, value: { version: FRAME_INDEX_VERSION, generatedAtMs, slotMinutes: SLOT_MINUTES, frames: entries, credits: creditLines } };
}
