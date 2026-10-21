import type { Result } from "@/lib/result";
import { isWatchUserId, MAX_WATCH_ITEMS, parseWatchItemRow, type WatchItem, type WatchRequest } from "@/lib/watchlist/watch-items";

// Server-only access to public.watch_items through PostgREST with the Supabase secret key (the table has no policy
// for the publishable key; supabase/migrations/20261019050000_watch_items.sql). Every call is scoped to one
// Supabase Auth user id, which the caller takes from the verified session, never from the request body.

// A slow database must not hold a page or an API call for long.
const STORE_TIMEOUT_MS = 8_000;

export type AddOutcome = "added" | "already-watched" | "limit-reached";

type StoreConfig = { tableUrl: string; secretKey: string };

function readStoreConfig(): Result<StoreConfig> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL is not set" };
  if (!secretKey) return { ok: false, reason: "SUPABASE_SECRET_KEY is not set" };
  return { ok: true, value: { tableUrl: `${projectUrl.replace(/\/+$/, "")}/rest/v1/watch_items`, secretKey } };
}

/** One PostgREST call; the body is read once and returned as text with the status. */
async function callStore(config: StoreConfig, init: { method: "GET" | "POST" | "DELETE"; query: string; body?: string; prefer?: string }): Promise<Result<{ status: number; text: string }>> {
  try {
    const response = await fetch(init.query ? `${config.tableUrl}?${init.query}` : config.tableUrl, {
      method: init.method,
      headers: {
        apikey: config.secretKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    return { ok: true, value: { status: response.status, text: await response.text() } };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, reason: isTimeout ? `the watchlist store did not answer within ${STORE_TIMEOUT_MS} ms` : `the watchlist store could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** PostgREST's error code, when the body carries one (23505 unique violation, P0001 the limit trigger). */
function readErrorCode(text: string): string | null {
  const payload = parseJson(text);
  return typeof payload === "object" && payload !== null && "code" in payload && typeof payload.code === "string" ? payload.code : null;
}

function prepare(userId: string): Result<StoreConfig> {
  if (!isWatchUserId(userId)) return { ok: false, reason: "the session's user id has an unexpected form" };
  return readStoreConfig();
}

/** The reader's watched items, newest first. */
export async function listWatchItems(userId: string): Promise<Result<WatchItem[]>> {
  const config = prepare(userId);
  if (!config.ok) return config;
  const query = `user_id=eq.${encodeURIComponent(userId)}&select=id,kind,ref,label,created_at&order=created_at.desc&limit=${MAX_WATCH_ITEMS}`;
  const called = await callStore(config.value, { method: "GET", query });
  if (!called.ok) return called;
  if (called.value.status !== 200) return { ok: false, reason: `the watchlist store answered ${called.value.status}` };
  const rows = parseJson(called.value.text);
  if (!Array.isArray(rows)) return { ok: false, reason: "the watchlist store answered something other than a list" };
  return { ok: true, value: rows.map(parseWatchItemRow).filter((item): item is WatchItem => item !== null) };
}

/** Adds one item; watching something already watched is not an error, and the 100-item limit is its own outcome. */
export async function addWatchItem(userId: string, request: WatchRequest): Promise<Result<AddOutcome>> {
  const config = prepare(userId);
  if (!config.ok) return config;
  const body = JSON.stringify({ user_id: userId, kind: request.kind, ref: request.ref, label: request.label });
  const called = await callStore(config.value, { method: "POST", query: "", body, prefer: "return=minimal" });
  if (!called.ok) return called;
  if (called.value.status === 201) return { ok: true, value: "added" };
  const code = readErrorCode(called.value.text);
  if (code === "23505") return { ok: true, value: "already-watched" };
  if (code === "P0001") return { ok: true, value: "limit-reached" };
  return { ok: false, reason: `the watchlist store refused the item (${called.value.status}${code ? `, ${code}` : ""})` };
}

/** Removes one of the reader's items by id; false when the reader has no item with that id. */
export async function removeWatchItem(userId: string, itemId: number): Promise<Result<boolean>> {
  const config = prepare(userId);
  if (!config.ok) return config;
  const query = `id=eq.${itemId}&user_id=eq.${encodeURIComponent(userId)}&select=id`;
  const called = await callStore(config.value, { method: "DELETE", query, prefer: "return=representation" });
  if (!called.ok) return called;
  if (called.value.status !== 200) return { ok: false, reason: `the watchlist store answered ${called.value.status}` };
  const removedRows = parseJson(called.value.text);
  return { ok: true, value: Array.isArray(removedRows) && removedRows.length > 0 };
}
