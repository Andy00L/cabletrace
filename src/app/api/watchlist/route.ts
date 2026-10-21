import { readSignedInReader } from "@/lib/auth/session";
import { parseWatchRequest } from "@/lib/watchlist/watch-items";
import { addWatchItem, listWatchItems, removeWatchItem } from "@/lib/watchlist/watch-store";

// /api/watchlist: the signed-in reader's watched cases, cables and ships. GET lists them, POST adds one, DELETE
// removes one by ?id=. The user id always comes from the verified Supabase session (src/lib/auth/session.ts), never
// from the request. Each failure has its own error code; reasons go to the logs, not the response.

// A reader's request body is a few hundred bytes; anything far larger is not a watch request.
const MAX_BODY_BYTES = 2_048;

function respond(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * A change must come from this site: browsers send Origin on POST and DELETE, so a mismatch is a request another site
 * made with the reader's cookies. (The session cookie is SameSite=Lax as a first guard.) A `no-referrer` referrer
 * policy would make browsers send "Origin: null" and refuse every change here: next.config.ts sets
 * strict-origin-when-cross-origin, which keeps the real origin.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export async function GET() {
  const reader = await readSignedInReader();
  if (reader === null) return respond(401, { error: "signed-out" });
  const listed = await listWatchItems(reader.id);
  if (!listed.ok) {
    console.error(`[GET /api/watchlist] ${listed.reason}`);
    return respond(503, { error: "store-unavailable" });
  }
  return respond(200, { items: listed.value });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return respond(403, { error: "cross-origin" });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond(415, { error: "json-only" });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return respond(413, { error: "too-large" });
  const reader = await readSignedInReader();
  if (reader === null) return respond(401, { error: "signed-out" });
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) return respond(413, { error: "too-large" });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return respond(400, { error: "invalid", reason: "the body is not JSON" });
  }
  const watchRequest = parseWatchRequest(body);
  if (!watchRequest.ok) return respond(400, { error: "invalid", reason: watchRequest.reason });
  const added = await addWatchItem(reader.id, watchRequest.value);
  if (!added.ok) {
    console.error(`[POST /api/watchlist] ${added.reason}`);
    return respond(503, { error: "store-unavailable" });
  }
  switch (added.value) {
    case "added":
      return respond(201, { outcome: "added" });
    case "already-watched":
      return respond(200, { outcome: "already-watched" });
    case "limit-reached":
      return respond(422, { error: "limit-reached" });
    default: {
      const unhandledOutcome: never = added.value;
      return unhandledOutcome;
    }
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return respond(403, { error: "cross-origin" });
  const reader = await readSignedInReader();
  if (reader === null) return respond(401, { error: "signed-out" });
  const idText = new URL(request.url).searchParams.get("id") ?? "";
  const itemId = /^\d{1,15}$/.test(idText) ? Number(idText) : null;
  if (itemId === null) return respond(400, { error: "invalid", reason: "id must be a positive whole number" });
  const removed = await removeWatchItem(reader.id, itemId);
  if (!removed.ok) {
    console.error(`[DELETE /api/watchlist] ${removed.reason}`);
    return respond(503, { error: "store-unavailable" });
  }
  return removed.value ? respond(200, { outcome: "removed" }) : respond(404, { error: "not-found" });
}
