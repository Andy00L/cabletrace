// The status island's countdown while the replay plays: how much replay time is left until the next event of the
// case, in whole minutes, as words a reader takes in at a glance ("in 38 min", "in 2 h 05 min", "in 5 days 10 h").

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
// From a day out the countdown drops its minutes: Rubymar's drift leaves 130 h between events, read as "5 days 10 h".
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * Whole minutes of replay time from `atMs` to the first event after it, rounded up so the countdown reaches 1 just
 * before the event; null when no event is left.
 */
export function readMinutesToNextEvent(eventTimesMs: readonly number[], atMs: number): number | null {
  let nextMs: number | null = null;
  for (const eventMs of eventTimesMs) {
    if (eventMs > atMs && (nextMs === null || eventMs < nextMs)) nextMs = eventMs;
  }
  return nextMs === null ? null : Math.ceil((nextMs - atMs) / MS_PER_MINUTE);
}

/** "in 1 min", "in 38 min", "in 2 h", "in 2 h 05 min", "in 1 day", "in 5 days 10 h". */
export function formatCountdown(minutes: number): string {
  const wholeMinutes = Math.max(1, Math.round(minutes));
  if (wholeMinutes < MINUTES_PER_HOUR) return `in ${wholeMinutes} min`;
  if (wholeMinutes >= MINUTES_PER_DAY) {
    const days = Math.floor(wholeMinutes / MINUTES_PER_DAY);
    const restHours = Math.floor((wholeMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
    const dayWords = `${days} ${days === 1 ? "day" : "days"}`;
    return restHours === 0 ? `in ${dayWords}` : `in ${dayWords} ${restHours} h`;
  }
  const hours = Math.floor(wholeMinutes / MINUTES_PER_HOUR);
  const restMinutes = wholeMinutes % MINUTES_PER_HOUR;
  return restMinutes === 0 ? `in ${hours} h` : `in ${hours} h ${String(restMinutes).padStart(2, "0")} min`;
}
