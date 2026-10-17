// Positions on the /live globe: a unit sphere, y up, longitude 0 facing +x, east toward -z (three.js's right-handed
// frame seen from above the north pole, so the globe turns the way the Earth does).

const RADIANS_PER_DEGREE = Math.PI / 180;

/** Writes the unit vector for a longitude and latitude (degrees) into `target` at `offset` (3 numbers). */
export function writeUnitVector(longitude: number, latitude: number, target: Float32Array, offset: number): void {
  const longitudeRadians = longitude * RADIANS_PER_DEGREE;
  const latitudeRadians = latitude * RADIANS_PER_DEGREE;
  const ringRadius = Math.cos(latitudeRadians);
  target[offset] = ringRadius * Math.cos(longitudeRadians);
  target[offset + 1] = Math.sin(latitudeRadians);
  target[offset + 2] = -ringRadius * Math.sin(longitudeRadians);
}

/** Longitude and latitude (degrees) of a direction from the globe's centre; it need not be unit length. */
export function readLongitudeLatitude(x: number, y: number, z: number): { longitude: number; latitude: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { longitude: Math.atan2(-z, x) / RADIANS_PER_DEGREE, latitude: Math.asin(Math.max(-1, Math.min(1, y / length))) / RADIANS_PER_DEGREE };
}

/** Great-circle angle between two unit vectors stored at offsets in two arrays, in radians. */
export function angleBetween(first: Float32Array, firstOffset: number, second: Float32Array, secondOffset: number): number {
  const dot = (first[firstOffset] ?? 0) * (second[secondOffset] ?? 0) + (first[firstOffset + 1] ?? 0) * (second[secondOffset + 1] ?? 0) + (first[firstOffset + 2] ?? 0) * (second[secondOffset + 2] ?? 0);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
