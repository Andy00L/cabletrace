// Gzip for stored ship frames, through the web-standard CompressionStream and DecompressionStream
// that Deno (the collector), browsers and Bun (tests) all provide.
// Frames are compressed before upload because Supabase Storage serves them as
// application/octet-stream, which its CDN does not compress on the way out.
// Type-only import: see the import rule at the top of snapshot-codec.ts.
import type { Result } from "../result.ts";

// A decoded frame of 30,000 ships is about 630 KB; anything far larger is not one of our frames.
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Copies into a fresh ArrayBuffer-backed array: Blob rejects views over a SharedArrayBuffer in
// current DOM typings, and the copy satisfies both older and newer TypeScript versions.
function toBlobPart(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

export async function gzipBytes(bytes: Uint8Array): Promise<Result<Uint8Array>> {
  try {
    const compressed = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
    return { ok: true, value: new Uint8Array(await new Response(compressed).arrayBuffer()) };
  } catch (error) {
    return { ok: false, reason: `gzip failed: ${describeError(error)}` };
  }
}

/** Gunzips, stopping at `maxBytes` of output so a corrupt or hostile file cannot exhaust memory. */
export async function gunzipBytes(bytes: Uint8Array, maxBytes: number = MAX_FRAME_BYTES): Promise<Result<Uint8Array>> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    const reader = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: `gunzip output passed ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false, reason: `gunzip failed: ${describeError(error)}` };
  }
  // One contiguous buffer starting at offset 0, so decodeShipFrame can view its columns without copying.
  const output = new Uint8Array(totalBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return { ok: true, value: output };
}
