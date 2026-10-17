import type { Result } from "@/lib/result";
import { gunzipBytes } from "@/lib/live/frame-compression";
import { FRAME_INDEX_PATH, parseFrameIndex, selectLiveFrames, type FrameIndexEntry } from "@/lib/live/frame-layout";
import { decodeShipFrame, type ShipFrameColumns } from "@/lib/live/snapshot-codec";

// Loads the day of ship frames for the /live globe through the cached route (src/app/api/ship-frames), keeping the
// most recent frames it decoded so scrubbing back and forth does not download them twice.

const FRAME_ROUTE = "/api/ship-frames";
const REQUEST_TIMEOUT_MS = 20_000;
// Decoded frames kept in memory: 8 hours of 10-minute slots, about 15 MB at 30,000 ships a frame.
const MAX_CACHED_FRAMES = 48;

export type FrameSource = {
  /** The frames of the last 24 hours, oldest first. */
  loadIndex: () => Promise<Result<FrameIndexEntry[]>>;
  /** One frame, decoded; concurrent calls for the same slot share one download. */
  loadFrame: (entry: FrameIndexEntry) => Promise<Result<ShipFrameColumns>>;
  /** The frame if it is already decoded, else null. */
  peekFrame: (entry: FrameIndexEntry) => ShipFrameColumns | null;
};

async function fetchBytes(url: string): Promise<Result<Uint8Array>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: `${url} answered ${response.status}` };
    return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { ok: false, reason: `${url} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function createFrameSource(): FrameSource {
  const pending = new Map<number, Promise<Result<ShipFrameColumns>>>();
  const decoded = new Map<number, ShipFrameColumns>();

  function remember(slotStartMs: number, frame: ShipFrameColumns) {
    decoded.delete(slotStartMs);
    decoded.set(slotStartMs, frame);
    // A Map iterates in insertion order, so the first key is the frame used longest ago.
    while (decoded.size > MAX_CACHED_FRAMES) {
      const oldest = decoded.keys().next();
      if (oldest.done) break;
      decoded.delete(oldest.value);
    }
  }

  async function downloadFrame(entry: FrameIndexEntry): Promise<Result<ShipFrameColumns>> {
    const compressed = await fetchBytes(`${FRAME_ROUTE}/${entry.path}`);
    if (!compressed.ok) return compressed;
    const raw = await gunzipBytes(compressed.value);
    if (!raw.ok) return raw;
    return decodeShipFrame(raw.value);
  }

  return {
    async loadIndex() {
      const bytes = await fetchBytes(`${FRAME_ROUTE}/${FRAME_INDEX_PATH}`);
      if (!bytes.ok) return bytes;
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes.value));
      } catch {
        return { ok: false, reason: "the frame index is not JSON" };
      }
      const index = parseFrameIndex(payload);
      return index.ok ? { ok: true, value: selectLiveFrames(index.value) } : index;
    },
    loadFrame(entry) {
      const cached = decoded.get(entry.slotStartMs);
      if (cached) {
        remember(entry.slotStartMs, cached);
        return Promise.resolve({ ok: true, value: cached });
      }
      const inFlight = pending.get(entry.slotStartMs);
      if (inFlight) return inFlight;
      const download = downloadFrame(entry).then((outcome) => {
        pending.delete(entry.slotStartMs);
        if (outcome.ok) remember(entry.slotStartMs, outcome.value);
        return outcome;
      });
      pending.set(entry.slotStartMs, download);
      return download;
    },
    peekFrame(entry) {
      return decoded.get(entry.slotStartMs) ?? null;
    },
  };
}
