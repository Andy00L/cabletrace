// Ambient occlusion baked into the overview terrain once, at build time: how much of the sky each grid point sees past
// the relief around it. A horizon search (the idea behind horizon-based AO, done on the height grid instead of the
// screen): in 8 directions, the steepest rise within 32 cells, its sine averaged. Hollows, valley floors and the foot
// of a slope come out darker; ridges and open plains stay at 1. Computed on the drawn (exaggerated) heights, so it
// matches the relief the viewer sees.

const DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
// Sample distances in cells: doubling, so near and far relief both count at little cost.
const STEPS_CELLS = [1, 2, 4, 8, 16, 32];
// How dark a fully enclosed point gets (0 to 1). Kept light: the house style is a bright studio, not a cave.
const OCCLUSION_STRENGTH = 0.45;

/**
 * Occlusion factor per grid point (1 open, down to 1 - OCCLUSION_STRENGTH enclosed). `heights` are scene heights
 * (km) row by row, `cellWidthKm` and `cellDepthKm` the grid spacing along a row and down a column.
 */
export function bakeReliefOcclusion(heights: Float32Array, columns: number, rows: number, cellWidthKm: number, cellDepthKm: number): Float32Array {
  const occlusion = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const height = heights[index] ?? 0;
      let sineSum = 0;
      for (const [stepColumn, stepRow] of DIRECTIONS) {
        let steepest = 0;
        for (const steps of STEPS_CELLS) {
          const sampleColumn = column + stepColumn * steps;
          const sampleRow = row + stepRow * steps;
          if (sampleColumn < 0 || sampleRow < 0 || sampleColumn >= columns || sampleRow >= rows) break;
          const rise = (heights[sampleRow * columns + sampleColumn] ?? height) - height;
          const distanceKm = Math.hypot(stepColumn * steps * cellWidthKm, stepRow * steps * cellDepthKm);
          steepest = Math.max(steepest, rise / distanceKm);
        }
        sineSum += steepest / Math.sqrt(1 + steepest * steepest);
      }
      occlusion[index] = 1 - OCCLUSION_STRENGTH * (sineSum / DIRECTIONS.length);
    }
  }
  return occlusion;
}
