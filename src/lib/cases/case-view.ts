import type { CableCase, CaseEvent, CaseEventKind, Citation } from "@/lib/cases/case-file";
import { formatUtcClock, formatUtcDate } from "@/lib/replay/format-utc";

// Plain values the case page shows, derived once on the server from a case file. Client components receive
// these, never the quotes, so the page ships only what it draws.

/** One row of the minute-by-minute list and one tick on the replay timeline. */
export type TimelineEvent = {
  atMs: number;
  /** "16:44" in UTC. */
  timeLabel: string;
  isTimeApproximate: boolean;
  kind: CaseEventKind;
  title: string;
  /** "Sources 31, 36" */
  sourceNote: string;
};

/** The distinct source numbers behind a set of citations, in first-cited order: "Source 19" or "Sources 31, 36". */
export function formatSourceNote(citations: readonly Citation[]): string {
  const sourceIds = [...new Set(citations.map((citation) => citation.sourceId))];
  return `${sourceIds.length === 1 ? "Source" : "Sources"} ${sourceIds.join(", ")}`;
}

/** "2024-12-26" to "26 Dec 2024"; anything else comes back as written. */
export function formatPublishedDate(publishedOn: string): string {
  const atMs = Date.parse(`${publishedOn}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(publishedOn) && Number.isFinite(atMs) ? formatUtcDate(atMs) : publishedOn;
}

function toTimelineEvent(event: CaseEvent): TimelineEvent {
  const atMs = Date.parse(event.atUtc);
  return {
    atMs,
    timeLabel: formatUtcClock(atMs),
    isTimeApproximate: event.isTimeApproximate,
    kind: event.kind,
    title: event.title,
    sourceNote: formatSourceNote(event.citations),
  };
}

/** The replay window's events, in time order. */
export function toTimelineEvents(cableCase: Pick<CableCase, "events">): TimelineEvent[] {
  return cableCase.events.map(toTimelineEvent).sort((first, second) => first.atMs - second.atMs);
}
