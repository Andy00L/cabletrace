// Replay times are always shown in UTC, the time base every source is converted to.

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "10:26" */
export function formatUtcClock(atMs: number): string {
  return Number.isFinite(atMs) ? CLOCK_FORMAT.format(atMs) : "--:--";
}

/** "25 Dec 2024" */
export function formatUtcDate(atMs: number): string {
  return Number.isFinite(atMs) ? DATE_FORMAT.format(atMs) : "";
}

/** "25 Dec" */
export function formatUtcDay(atMs: number): string {
  return Number.isFinite(atMs) ? DAY_FORMAT.format(atMs) : "";
}
