import type { Result } from "@/lib/result";

// What a signed-in reader can watch, and the checks every request and stored row passes before it is trusted
// (supabase/migrations/20261019050000_watch_items.sql holds the same limits as table checks).

export type WatchKind = "case" | "cable" | "ship";
export type WatchRequest = { kind: WatchKind; ref: string; label: string };
export type WatchItem = WatchRequest & { id: number; createdAtMs: number };

const WATCH_KINDS: readonly WatchKind[] = ["case", "cable", "ship"];
// The table's trigger enforces the same number.
export const MAX_WATCH_ITEMS = 100;
const MAX_REF_LENGTH = 120;
const MAX_LABEL_LENGTH = 200;
// A case is referenced by its slug, a ship by its nine-digit MMSI, a cable by its name as the seabed files spell it.
const CASE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MMSI_PATTERN = /^\d{9}$/;
// Supabase Auth user ids: lowercase UUIDs (supabase/migrations/20261021100000_watch_items_supabase_users.sql).
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// C0 control characters end at U+001F; U+007F is DEL. Neither belongs in a name or a label.
const LAST_C0_CONTROL = 0x1f;
const DELETE_CHARACTER = 0x7f;

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= LAST_C0_CONTROL || codePoint === DELETE_CHARACTER;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWatchKind(value: unknown): value is WatchKind {
  return typeof value === "string" && WATCH_KINDS.some((kind) => kind === value);
}

function checkText(value: unknown, name: string, maxLength: number): Result<string> {
  if (typeof value !== "string") return { ok: false, reason: `${name} must be text` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: `${name} is empty` };
  if (trimmed.length > maxLength) return { ok: false, reason: `${name} is longer than ${maxLength} characters` };
  if (hasControlCharacter(trimmed)) return { ok: false, reason: `${name} contains control characters` };
  return { ok: true, value: trimmed };
}

/** True for a Supabase Auth user id, the only kind the store accepts. */
export function isWatchUserId(userId: string): boolean {
  return USER_ID_PATTERN.test(userId);
}

/** Validates the body of a request to watch something. */
export function parseWatchRequest(body: unknown): Result<WatchRequest> {
  if (!isRecord(body)) return { ok: false, reason: "the body must be a JSON object" };
  if (!isWatchKind(body.kind)) return { ok: false, reason: `kind must be one of ${WATCH_KINDS.join(", ")}` };
  const ref = checkText(body.ref, "ref", MAX_REF_LENGTH);
  if (!ref.ok) return ref;
  const label = checkText(body.label, "label", MAX_LABEL_LENGTH);
  if (!label.ok) return label;
  if (body.kind === "case" && !CASE_SLUG_PATTERN.test(ref.value)) return { ok: false, reason: "a case ref is its slug" };
  if (body.kind === "ship" && !MMSI_PATTERN.test(ref.value)) return { ok: false, reason: "a ship ref is its nine-digit MMSI" };
  return { ok: true, value: { kind: body.kind, ref: ref.value, label: label.value } };
}

/** Validates one row of public.watch_items as PostgREST returns it; null for a row that does not fit. */
export function parseWatchItemRow(row: unknown): WatchItem | null {
  if (!isRecord(row)) return null;
  const { id, kind, ref, label, created_at: createdAt } = row;
  if (typeof id !== "number" || !Number.isInteger(id) || !isWatchKind(kind) || typeof ref !== "string" || typeof label !== "string" || typeof createdAt !== "string") return null;
  const createdAtMs = Date.parse(createdAt);
  return Number.isNaN(createdAtMs) ? null : { id, kind, ref, label, createdAtMs };
}
