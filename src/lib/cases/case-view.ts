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

/** How a case knows where the vessel was: placed positions, recorded AIS, placed then recorded from a moment, or interleaved. */
type TrackEvidence = { kind: "reconstructed" } | { kind: "recorded" } | { kind: "handover"; recordedFromMs: number } | { kind: "interleaved" };

function classifyTrackEvidence(cableCase: Pick<CableCase, "track" | "recordedTrack">): TrackEvidence {
  const firstFix = cableCase.recordedTrack?.fixes[0];
  if (!firstFix) return { kind: "reconstructed" };
  if (cableCase.track.length === 0) return { kind: "recorded" };
  const recordedFromMs = Date.parse(firstFix.atUtc);
  const isPlacedBeforeRecorded = cableCase.track.every((position) => Date.parse(position.atUtc) < recordedFromMs);
  return isPlacedBeforeRecorded ? { kind: "handover", recordedFromMs } : { kind: "interleaved" };
}

/** How the case knows where the vessel was, in one sentence for the ship card. */
export function describeTrackEvidence(cableCase: Pick<CableCase, "track" | "recordedTrack">): string {
  const evidence = classifyTrackEvidence(cableCase);
  switch (evidence.kind) {
    case "reconstructed":
      return "Positions here are reconstructed from statements, never recorded.";
    case "recorded":
      return "Positions here are AIS reports the ship broadcast.";
    case "handover":
      return `Until ${formatUtcClock(evidence.recordedFromMs)} UTC positions are reconstructed from statements; after that they are AIS reports the ship broadcast.`;
    case "interleaved":
      return "Some positions are reconstructed from statements; the others are AIS reports the ship broadcast.";
    default: {
      const unhandled: never = evidence;
      return unhandled;
    }
  }
}

/** The same in a few words, for the case list. */
export function describeTrackEvidenceBriefly(cableCase: Pick<CableCase, "track" | "recordedTrack">): string {
  const evidence = classifyTrackEvidence(cableCase);
  switch (evidence.kind) {
    case "reconstructed":
      return "Reconstructed from statements";
    case "recorded":
      return "AIS reports";
    case "handover":
      return `Reconstructed, then AIS from ${formatUtcClock(evidence.recordedFromMs)} UTC`;
    case "interleaved":
      return "Reconstructed and AIS";
    default: {
      const unhandled: never = evidence;
      return unhandled;
    }
  }
}

/** The replay window's events, in time order. */
export function toTimelineEvents(cableCase: Pick<CableCase, "events">): TimelineEvent[] {
  return cableCase.events.map(toTimelineEvent).sort((first, second) => first.atMs - second.atMs);
}
