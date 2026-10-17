export type FrameSummary = {
  frameCount: number;
  averageMs: number;
  slowFrameMs: number;
  framesPerSecond: number;
};

// Share of frames allowed to be slower than `slowFrameMs` (95th percentile).
const SLOW_FRAME_PERCENTILE = 0.95;

/**
 * Summarizes measured frame durations (milliseconds between two animation frames).
 * Returns null when there is nothing to summarize, so callers render a "not measured" state.
 */
export function summarizeFrameDurations(durationsMs: readonly number[]): FrameSummary | null {
  const validDurations = durationsMs.filter((duration) => Number.isFinite(duration) && duration > 0);
  if (validDurations.length === 0) return null;
  const totalMs = validDurations.reduce((sum, duration) => sum + duration, 0);
  const averageMs = totalMs / validDurations.length;
  const sortedDurations = [...validDurations].sort((first, second) => first - second);
  const percentileIndex = Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * SLOW_FRAME_PERCENTILE) - 1);
  return {
    frameCount: validDurations.length,
    averageMs,
    slowFrameMs: sortedDurations[percentileIndex] ?? averageMs,
    framesPerSecond: 1000 / averageMs,
  };
}
