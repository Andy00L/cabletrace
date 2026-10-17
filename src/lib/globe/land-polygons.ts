import type { Result } from "@/lib/result";

// The land outline the globe paints (public/globe/land.json, built by scripts/globe/build-land.ts), validated where
// it enters. Kept apart from land-texture.ts so the page can read the file without pulling three.js into its first
// load: the renderer arrives later, with the globe.

/** Each polygon is a list of rings, each ring a flat [longitude, latitude, ...] array. */
export type LandPolygons = number[][][];

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

/** Validates public/globe/land.json. */
export function parseLandPolygons(payload: unknown): Result<LandPolygons> {
  if (typeof payload !== "object" || payload === null || !("polygons" in payload) || !Array.isArray(payload.polygons)) {
    return { ok: false, reason: "land file has no polygon list" };
  }
  const polygons: LandPolygons = [];
  for (const polygon of payload.polygons) {
    if (!Array.isArray(polygon) || !polygon.every((ring) => isNumberArray(ring) && ring.length >= 6 && ring.length % 2 === 0)) {
      return { ok: false, reason: "land file has a malformed polygon" };
    }
    polygons.push(polygon);
  }
  return { ok: true, value: polygons };
}

