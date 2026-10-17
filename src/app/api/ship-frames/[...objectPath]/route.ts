import { FRAME_INDEX_PATH, FRAMES_FOLDER, SLOT_MS, frameObjectUrl, parseFrameObjectName } from "@/lib/live/frame-layout";

// Serves the /live globe's ship frames and their index from Vercel's CDN instead of straight from Supabase Storage.
// A frame never changes once the collector has written it, so the CDN keeps it for two days and every later viewer
// costs Supabase nothing: a full day of frames is about 32 MB, which per viewer would use up the free plan's 5 GB of
// Storage egress within a few hundred visits (plan/decision-log.md, 2026-10-17).

const UPSTREAM_TIMEOUT_MS = 15_000;
// The index changes every 10 minutes (one collector run per slot): a minute at the CDN keeps it fresh.
const INDEX_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=60";
// Frames older than two slots are final. 48 hours outlasts their 47-hour retention, after which no index names them.
const SEALED_FRAME_CACHE_CONTROL = "public, max-age=86400, s-maxage=172800, immutable";
// The newest slots' frames: final too in practice, but held briefly in case a run is retried.
const RECENT_FRAME_CACHE_CONTROL = "public, max-age=60, s-maxage=600";
// A missing object is asked for again soon, not cached for long.
const MISSING_CACHE_CONTROL = "public, max-age=10, s-maxage=30";

type ObjectRequest = { objectPath: string; contentType: string; cacheControl: string };

/** Accepts only index.json and frames/<slot>.bin.gz, so the route can never reach anything else in Storage. */
function resolveObject(segments: readonly string[], nowMs: number): ObjectRequest | null {
  if (segments.length === 1 && segments[0] === FRAME_INDEX_PATH) {
    return { objectPath: FRAME_INDEX_PATH, contentType: "application/json", cacheControl: INDEX_CACHE_CONTROL };
  }
  const [folder, name] = segments;
  if (segments.length !== 2 || folder !== FRAMES_FOLDER || name === undefined) return null;
  const slotStart = parseFrameObjectName(name);
  if (!slotStart.ok) return null;
  const isSealed = slotStart.value + 2 * SLOT_MS <= nowMs;
  return {
    objectPath: `${FRAMES_FOLDER}/${name}`,
    contentType: "application/octet-stream",
    cacheControl: isSealed ? SEALED_FRAME_CACHE_CONTROL : RECENT_FRAME_CACHE_CONTROL,
  };
}

export async function GET(_request: Request, context: RouteContext<"/api/ship-frames/[...objectPath]">) {
  const { objectPath } = await context.params;
  const requested = resolveObject(objectPath, Date.now());
  if (!requested) return Response.json({ ok: false, reason: "not a ship frame or the frame index" }, { status: 404 });
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    console.error("[shipFramesRoute] NEXT_PUBLIC_SUPABASE_URL is not set");
    return Response.json({ ok: false, reason: "frame storage is not configured" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  let upstream: Response;
  try {
    upstream = await fetch(frameObjectUrl(projectUrl, requested.objectPath), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    console.error(`[shipFramesRoute] ${requested.objectPath} unreachable: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ ok: false, reason: "frame storage unreachable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  // Supabase Storage answers 400 for a missing object in a public bucket, so both read as "not stored yet".
  if (upstream.status === 404 || upstream.status === 400) {
    return Response.json({ ok: false, reason: `${requested.objectPath} is not stored` }, { status: 404, headers: { "Cache-Control": MISSING_CACHE_CONTROL } });
  }
  if (!upstream.ok || upstream.body === null) {
    console.error(`[shipFramesRoute] ${requested.objectPath} answered ${upstream.status}`);
    return Response.json({ ok: false, reason: `frame storage answered ${upstream.status}` }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(upstream.body, { status: 200, headers: { "Content-Type": requested.contentType, "Cache-Control": requested.cacheControl } });
}
