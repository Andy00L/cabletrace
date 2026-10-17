// Replay times are always shown in UTC, the time base every source is converted to.

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

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

/** "25 December" */
export function formatUtcLongDay(atMs: number): string {
  return Number.isFinite(atMs) ? LONG_DAY_FORMAT.format(atMs) : "";
}

/** "26 Dec 2024, 00:28": date and wall clock in an IANA time zone, for the local time beside UTC. */
export function formatZonedDateTime(atMs: number, timeZone: string): string {
  if (!Number.isFinite(atMs)) return "";
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(atMs);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(atMs);
  return `${date}, ${clock}`;
}
