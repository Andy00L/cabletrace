import { FRAME_BUCKET } from "@/lib/live/frame-layout";
import type { Result } from "@/lib/result";

// Server-only reads of the ship-frames bucket. The bucket is private (supabase/migrations/
// 20261019060000_close_public_reads.sql), so viewers reach frames only through the CDN-cached /api/ship-frames route,
// and a stranger cannot download them straight from Storage around the cache.

export type FrameStorageConfig = { projectUrl: string; secretKey: string };

/** The project URL and the secret key, or which one is missing. */
export function readFrameStorageConfig(): Result<FrameStorageConfig> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL is not set" };
  if (!secretKey) return { ok: false, reason: "SUPABASE_SECRET_KEY is not set" };
  return { ok: true, value: { projectUrl: projectUrl.replace(/\/+$/u, ""), secretKey } };
}

/**
 * GET one object of the bucket with the secret key. Returns the upstream response for the caller to judge (Storage
 * answers 400 or 404 for a missing object); a network failure or a timeout is the error.
 */
export async function fetchFrameObject(config: FrameStorageConfig, objectPath: string, timeoutMs: number): Promise<Result<Response>> {
  try {
    const response = await fetch(`${config.projectUrl}/storage/v1/object/authenticated/${FRAME_BUCKET}/${objectPath}`, {
      headers: { apikey: config.secretKey },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: true, value: response };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, reason: isTimeout ? `${objectPath} did not answer within ${timeoutMs} ms` : `${objectPath} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
