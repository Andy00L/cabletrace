import type { CableKind } from "@/lib/detection/detection-types";

// Fault signals: what the network side publishes when a cable breaks (a power link trips, a country's internet drops,
// a hydrographic office warns of cable work). Pure data, shared by the Supabase edge function (Deno), the replay
// script (Bun) and the browser. Every parser in this folder turns one source into FaultSignal values.

export type SignalSource = "nga-warning" | "ioda-alert" | "entsoe-unavailability" | "nordpool-umm" | "operator-notice";

export type SignalKind = "cable-damage" | "cable-repair" | "cable-operations" | "power-link-failure" | "internet-outage";

/** A position as [longitude, latitude] in degrees, the GeoJSON order. */
export type LonLatPair = [number, number];

export type SignalGeometry =
  | { kind: "tracklines"; lines: LonLatPair[][] }
  | { kind: "area"; ring: LonLatPair[] }
  | { kind: "points"; points: LonLatPair[] };

/** How a signal says what it concerns; the matcher (cable-matcher.ts) turns it into registry cables. */
export type SignalLocator =
  | { kind: "geometry"; geometry: SignalGeometry }
  /** A power link by name, and the two countries it joins (null when the source withholds the asset). */
  | { kind: "asset"; assetNames: string[]; countries: [string, string] | null }
  /** A whole country, ISO 3166-1 alpha-2. */
  | { kind: "country"; country: string };

export type FaultSignal = {
  source: SignalSource;
  /** Stable identity within the source; a new revision of a message is a new id. */
  externalId: string;
  kind: SignalKind;
  /** One plain line, written from the source's fields. */
  title: string;
  /** The earliest and latest moment the source allows for the start of the fault (equal when it gives a time). */
  faultNotBeforeMs: number;
  faultNotAfterMs: number;
  publishedAtMs: number;
  /** When the source says the condition ends, or null for "until further notice". */
  endsAtMs: number | null;
  locator: SignalLocator;
  /** The cable ship a warning names, when it names one. */
  cableShip: string | null;
  sourceUrl: string;
  /** The source's own words, at most EXCERPT_MAX_CHARS; empty when the source's terms do not allow redisplay. */
  excerpt: string;
};

// Excerpts are stored and served to anyone; one NGA warning runs to 2,000 characters at most in the 17 Oct 2026 feed.
export const EXCERPT_MAX_CHARS = 2000;

/** A cable or pipeline of public.cables as the matcher needs it: every route part, and its landing countries. */
export type RegistryCable = {
  id: number;
  name: string;
  kind: CableKind;
  lines: LonLatPair[][];
  /** ISO 3166-1 alpha-2 codes of the countries the cable lands in (public.cable_landing_countries). */
  countries: string[];
};
