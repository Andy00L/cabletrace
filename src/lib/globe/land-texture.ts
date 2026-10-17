import * as THREE from "three";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import type { LandPolygons } from "@/lib/globe/land-polygons";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// The globe's surface: Natural Earth land (public/globe/land.json, scripts/globe/build-land.ts) painted once into an
// equirectangular canvas, land in the `land` token on water in `depth-40`, with a thin coastline so the two pale tones
// read apart. Color stays in the data drawn on top.

// Coastline width in texture pixels at the 4,096 px wide texture.
const COAST_WIDTH_PX = 1.2;
// Natural Earth's seams: rings are cut at the 180th meridian and Antarctica is closed along 90 S.
const SEAM_LONGITUDE = 179.99;
const SEAM_LATITUDE = -89.99;

/** A longitude and latitude box (degrees) a texture covers, edge to edge. */
export type LandBox = { west: number; east: number; south: number; north: number };

export const WORLD_BOX: LandBox = { west: -180, east: 180, south: -90, north: 90 };

function ringOverlapsBox(ring: readonly number[], box: LandBox): boolean {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 2) {
    const longitude = ring[index] ?? 0;
    const latitude = ring[index + 1] ?? 0;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return west <= box.east && east >= box.west && south <= box.north && north >= box.south;
}

/**
 * Paints the land inside `box` into a `width` by `height` px texture, as an equirectangular image of that box. The
 * caller disposes it.
 */
export function createLandTexture(polygons: LandPolygons, { box, width, height }: { box: LandBox; width: number; height: number }): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  // Kept as raw sRGB bytes: the globe's shader writes them out unconverted, so the palette tones land on screen exact.
  texture.colorSpace = THREE.NoColorSpace;
  if (!context) return texture;
  context.fillStyle = WEBGL_COLORS.depth40;
  context.fillRect(0, 0, width, height);
  const toX = (longitude: number) => ((longitude - box.west) / (box.east - box.west)) * width;
  const toY = (latitude: number) => ((box.north - latitude) / (box.north - box.south)) * height;
  const land = new Path2D();
  // The coastline skips the edges Natural Earth adds where it splits land at the 180th meridian and where it closes
  // Antarctica along the pole: they are seams, not coasts.
  const coast = new Path2D();
  const isSeam = (fromLongitude: number, fromLatitude: number, toLongitude: number, toLatitude: number) =>
    (Math.abs(fromLongitude) >= SEAM_LONGITUDE && Math.abs(toLongitude) >= SEAM_LONGITUDE) || (fromLatitude <= SEAM_LATITUDE && toLatitude <= SEAM_LATITUDE);
  for (const polygon of polygons) {
    const [outerRing] = polygon;
    if (!outerRing || !ringOverlapsBox(outerRing, box)) continue;
    for (const ring of polygon) {
      const pointCount = ring.length / 2;
      for (let index = 0; index <= pointCount; index += 1) {
        const pointIndex = (index % pointCount) * 2;
        const longitude = ring[pointIndex] ?? 0;
        const latitude = ring[pointIndex + 1] ?? 0;
        const x = toX(longitude);
        const y = toY(latitude);
        if (index === 0) {
          land.moveTo(x, y);
          coast.moveTo(x, y);
          continue;
        }
        if (index < pointCount) land.lineTo(x, y);
        const previousIndex = ((index - 1) % pointCount) * 2;
        if (isSeam(ring[previousIndex] ?? 0, ring[previousIndex + 1] ?? 0, longitude, latitude)) coast.moveTo(x, y);
        else coast.lineTo(x, y);
      }
      land.closePath();
    }
  }
  context.fillStyle = WEBGL_COLORS.land;
  context.fill(land, "evenodd");
  context.strokeStyle = SCENE_COLORS.seabedContour;
  context.lineWidth = COAST_WIDTH_PX * (width / 4096);
  context.lineJoin = "round";
  context.stroke(coast);
  texture.needsUpdate = true;
  return texture;
}
