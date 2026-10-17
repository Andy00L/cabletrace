// Small numeric helpers shared by the seabed scene builders. All pure, all deterministic.

export function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function easeOutCubic(amount: number): number {
  return 1 - Math.pow(1 - amount, 3);
}

/** Hermite step between two edges, 0 below the first and 1 above the second. */
export function smoothStep(edgeStart: number, edgeEnd: number, value: number): number {
  const amount = clampValue((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

/** Deterministic random numbers in [0, 1) (mulberry32), so illustrated detail is identical on every load. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function hashLattice(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Smooth value noise in [0, 1]. */
export function sampleValueNoise(positionX: number, positionY: number): number {
  const leftColumn = Math.floor(positionX);
  const topRow = Math.floor(positionY);
  const fractionX = positionX - leftColumn;
  const fractionY = positionY - topRow;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedY = fractionY * fractionY * (3 - 2 * fractionY);
  const topEdge = interpolate(hashLattice(leftColumn, topRow), hashLattice(leftColumn + 1, topRow), easedX);
  const bottomEdge = interpolate(hashLattice(leftColumn, topRow + 1), hashLattice(leftColumn + 1, topRow + 1), easedX);
  return interpolate(topEdge, bottomEdge, easedY);
}

/** Sum of value-noise octaves; stays in [0, 1). */
export function sampleFractalNoise(positionX: number, positionY: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * sampleValueNoise(positionX * frequency, positionY * frequency);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}
