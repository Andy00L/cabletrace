import type { FrameIndexEntry } from "@/lib/live/frame-layout";

// The /live timeline runs from the oldest frame of the day to the newest. A moment between two frames blends them;
// the clock's position on the timeline is a share of that span.

export type MomentFrames = {
  /** Index of the frame at or before the moment. */
  earlierIndex: number;
  /** Index of the next frame, or null at the newest frame. */
  laterIndex: number | null;
  /** 0 at the earlier frame's slot, 1 at the later one's. */
  blend: number;
};

/** The frames on either side of `atMs`; the entries are oldest first and not empty. */
export function locateMoment(entries: readonly FrameIndexEntry[], atMs: number): MomentFrames {
  let low = 0;
  let high = entries.length - 1;
  // The last entry whose slot starts at or before the moment (the first entry when the moment is earlier).
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((entries[middle]?.slotStartMs ?? 0) <= atMs) low = middle;
    else high = middle - 1;
  }
  const earlier = entries[low];
  const later = entries[low + 1];
  if (!earlier || !later) return { earlierIndex: low, laterIndex: null, blend: 0 };
  const spanMs = later.slotStartMs - earlier.slotStartMs;
  const blend = spanMs > 0 ? Math.min(1, Math.max(0, (atMs - earlier.slotStartMs) / spanMs)) : 0;
  return { earlierIndex: low, laterIndex: low + 1, blend };
}

/** The timeline's span: the oldest frame's slot to the newest one's. */
export function daySpan(entries: readonly FrameIndexEntry[]): { startMs: number; endMs: number } {
  return { startMs: entries[0]?.slotStartMs ?? 0, endMs: entries[entries.length - 1]?.slotStartMs ?? 0 };
}
