import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

// The replay console keeps its state in the URL, so a shared link reopens the same moment, view, mode and open
// card, and the back button closes the last card opened. This file turns query parameters into a validated state
// and back. Every unknown or out-of-range value falls back to its default instead of failing the page. Following the
// ship is the Vessel view, so it needs no key of its own.

export type ConsoleMode = "replay" | "ship" | "evidence";
export type SeabedDetail = "measured" | "illustrated";

/** The one card, sheet or dialog open over the console. */
export type ConsoleLayer =
  | { kind: "none" }
  | { kind: "vessel" }
  | { kind: "cut"; cutIndex: number }
  | { kind: "placement"; positionIndex: number }
  | { kind: "source"; sourceId: number }
  | { kind: "sources" }
  | { kind: "aftermath" }
  | { kind: "shortcuts" };

export type ConsoleState = {
  atMs: number;
  view: SeabedViewName;
  mode: ConsoleMode;
  detail: SeabedDetail;
  layer: ConsoleLayer;
};

/** What the codec needs to know about the case to validate a link. */
export type ConsoleContext = {
  windowStartMs: number;
  windowEndMs: number;
  /** One slug per cut, in case order (see `toCutSlug`). */
  cutSlugs: readonly string[];
  placementCount: number;
  sourceIds: readonly number[];
};

const VIEWS: readonly SeabedViewName[] = ["overview", "top", "vessel", "closeup"];
const MODES: readonly ConsoleMode[] = ["replay", "ship", "evidence"];
const DETAILS: readonly SeabedDetail[] = ["measured", "illustrated"];
const DEFAULT_VIEW: SeabedViewName = "overview";
const DEFAULT_MODE: ConsoleMode = "replay";
const DEFAULT_DETAIL: SeabedDetail = "illustrated";
// The scrubber moves in whole minutes, so links carry minutes: 2024-12-25T16:44Z.
const MINUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/;
const MS_PER_MINUTE = 60_000;

/** "C-Lion 1" to "c-lion-1": the cut's label as it appears in a link. */
export function toCutSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickOne<TValue extends string>(options: readonly TValue[], raw: string | undefined, fallback: TValue): TValue {
  return options.find((option) => option === raw) ?? fallback;
}

function parseMinute(raw: string | undefined, context: ConsoleContext): number {
  const match = raw ? MINUTE_PATTERN.exec(raw) : null;
  if (!match) return context.windowStartMs;
  const atMs = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`);
  if (!Number.isFinite(atMs)) return context.windowStartMs;
  return Math.min(context.windowEndMs, Math.max(context.windowStartMs, atMs));
}

function parseIndex(raw: string, limit: number): number | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  const index = Number(raw);
  return index < limit ? index : null;
}

function parseLayer(raw: string | undefined, context: ConsoleContext): ConsoleLayer {
  if (!raw) return { kind: "none" };
  if (raw === "vessel" || raw === "sources" || raw === "aftermath" || raw === "shortcuts") return { kind: raw };
  if (raw.startsWith("cut-")) {
    const cutIndex = context.cutSlugs.indexOf(raw.slice("cut-".length));
    return cutIndex >= 0 ? { kind: "cut", cutIndex } : { kind: "none" };
  }
  if (raw.startsWith("placement-")) {
    const positionIndex = parseIndex(raw.slice("placement-".length), context.placementCount);
    return positionIndex === null ? { kind: "none" } : { kind: "placement", positionIndex };
  }
  if (raw.startsWith("source-")) {
    const sourceId = parseIndex(raw.slice("source-".length), Number.MAX_SAFE_INTEGER);
    return sourceId !== null && context.sourceIds.includes(sourceId) ? { kind: "source", sourceId } : { kind: "none" };
  }
  return { kind: "none" };
}

function formatLayer(layer: ConsoleLayer, context: ConsoleContext): string | null {
  switch (layer.kind) {
    case "none":
      return null;
    case "vessel":
    case "sources":
    case "aftermath":
    case "shortcuts":
      return layer.kind;
    case "cut": {
      const slug = context.cutSlugs[layer.cutIndex];
      return slug ? `cut-${slug}` : null;
    }
    case "placement":
      return `placement-${layer.positionIndex}`;
    case "source":
      return `source-${layer.sourceId}`;
    default: {
      const unhandled: never = layer;
      return unhandled;
    }
  }
}

/** "2024-12-25T16:44Z" for a moment, rounded down to its minute. */
export function formatMinute(atMs: number): string {
  const minuteMs = Math.floor(atMs / MS_PER_MINUTE) * MS_PER_MINUTE;
  return `${new Date(minuteMs).toISOString().slice(0, 16)}Z`;
}

/** Reads the console state from query parameters (a Next.js `searchParams` record or a URLSearchParams). */
export function parseConsoleState(params: Readonly<Record<string, string | string[] | undefined>> | URLSearchParams, context: ConsoleContext): ConsoleState {
  const read = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    atMs: parseMinute(read("t"), context),
    view: pickOne(VIEWS, read("view"), DEFAULT_VIEW),
    mode: pickOne(MODES, read("mode"), DEFAULT_MODE),
    detail: pickOne(DETAILS, read("detail"), DEFAULT_DETAIL),
    layer: parseLayer(read("layer"), context),
  };
}

/** Writes the state as a query string, leaving out every value that equals its default. */
export function formatConsoleState(state: ConsoleState, context: ConsoleContext): string {
  const params = new URLSearchParams();
  if (Math.floor(state.atMs / MS_PER_MINUTE) !== Math.floor(context.windowStartMs / MS_PER_MINUTE)) params.set("t", formatMinute(state.atMs));
  if (state.view !== DEFAULT_VIEW) params.set("view", state.view);
  if (state.mode !== DEFAULT_MODE) params.set("mode", state.mode);
  if (state.detail !== DEFAULT_DETAIL) params.set("detail", state.detail);
  const layer = formatLayer(state.layer, context);
  if (layer) params.set("layer", layer);
  // A colon is legal in a query string (RFC 3986, section 3.4); keeping it makes the minute readable in a link.
  return params.toString().replaceAll("%3A", ":");
}
