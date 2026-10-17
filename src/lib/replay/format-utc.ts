// Replay times are always shown in UTC, the time base every source is converted to.

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const DAY_OF_MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** True when both moments fall on the same UTC calendar day. */
export function isSameUtcDay(firstMs: number, secondMs: number): boolean {
  return Math.floor(firstMs / MS_PER_DAY) === Math.floor(secondMs / MS_PER_DAY);
}

/** The UTC days a window covers: "25 December", "17 and 18 November", "17 to 19 November", "30 November to 1 December". */
export function formatUtcDaySpan(startMs: number, endMs: number): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  if (isSameUtcDay(startMs, endMs)) return LONG_DAY_FORMAT.format(startMs);
  if (MONTH_FORMAT.format(startMs) !== MONTH_FORMAT.format(endMs)) return `${LONG_DAY_FORMAT.format(startMs)} to ${LONG_DAY_FORMAT.format(endMs)}`;
  const joiner = Math.floor(endMs / MS_PER_DAY) - Math.floor(startMs / MS_PER_DAY) === 1 ? "and" : "to";
  return `${DAY_OF_MONTH_FORMAT.format(startMs)} ${joiner} ${LONG_DAY_FORMAT.format(endMs)}`;
}

/** "26 Dec 2024, 00:28": date and wall clock in an IANA time zone, for the local time beside UTC. */
export function formatZonedDateTime(atMs: number, timeZone: string): string {
  if (!Number.isFinite(atMs)) return "";
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(atMs);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(atMs);
  return `${date}, ${clock}`;
}
