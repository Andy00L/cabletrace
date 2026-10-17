import { fetchFrameObject, readFrameStorageConfig } from "@/lib/frames/frame-storage";
import { FRAME_INDEX_PATH, parseFrameIndex, SLOT_MS } from "@/lib/live/frame-layout";
import type { Result } from "@/lib/result";

// Whether the world ship collector still writes frames: it rewrites ship-frames/index.json on every run, every
// 10 minutes (supabase/migrations/20261018400100_ship_frames_schedule.sql). An index older than three runs means the
// schedule or the function stopped.
const STALE_AFTER_MS = 3 * SLOT_MS;
// A slow storage read must not hold the health check for long.
const INDEX_TIMEOUT_MS = 8_000;
const MS_PER_MINUTE = 60_000;

export type CollectorHealth = { state: "collecting" | "stale"; minutesSinceIndex: number; framesStored: number; newestFrameAt: string | null };

/** Reads the frame index from the (private) frame bucket and judges it against `nowMs`. */
export async function checkCollectorHealth(nowMs: number): Promise<Result<CollectorHealth>> {
  const config = readFrameStorageConfig();
  if (!config.ok) return config;
  const fetched = await fetchFrameObject(config.value, FRAME_INDEX_PATH, INDEX_TIMEOUT_MS);
  if (!fetched.ok) return fetched;
  if (!fetched.value.ok) return { ok: false, reason: `the frame index answered ${fetched.value.status}` };
  let payload: unknown;
  try {
    payload = JSON.parse(await fetched.value.text());
  } catch (error) {
    return { ok: false, reason: `the frame index is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const frameIndex = parseFrameIndex(payload);
  if (!frameIndex.ok) return frameIndex;
  const ageMs = Math.max(0, nowMs - frameIndex.value.generatedAtMs);
  const newestFrame = frameIndex.value.frames.at(-1);
  return {
    ok: true,
    value: {
      state: ageMs > STALE_AFTER_MS ? "stale" : "collecting",
      minutesSinceIndex: Math.floor(ageMs / MS_PER_MINUTE),
      framesStored: frameIndex.value.frames.length,
      newestFrameAt: newestFrame ? new Date(newestFrame.slotStartMs).toISOString() : null,
    },
  };
}
