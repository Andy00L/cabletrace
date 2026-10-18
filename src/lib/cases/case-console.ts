import type { CableCase, Citation } from "@/lib/cases/case-file";
import { toCutSlug } from "@/lib/console/console-state";
import { describeTrackEvidence, describeTrackEvidenceBriefly, formatPublishedDate, formatSourceNote, toTimelineEvents, type TimelineEvent } from "@/lib/cases/case-view";
import { formatUtcClock, formatUtcDate, formatUtcDay, formatUtcDaySpan, isSameUtcDay } from "@/lib/replay/format-utc";

// Everything the replay console shows about a case, as plain values built once on the server: each item carries
// its quotes, so any card, popover or sheet can open from anywhere without another request.

export type CitationView = { sourceId: number; quote: string; translation: string | null };

/** A quote as one source contributes it, with what it supports. */
export type SourceUse = { supports: string; quote: string; translation: string | null };

export type ConsoleSource = {
  id: number;
  publisher: string;
  title: string;
  url: string;
  archivedUrl: string | null;
  /** "26 Dec 2024" */
  publishedLabel: string;
  uses: SourceUse[];
};

export type ConsolePosition = {
  atMs: number;
  timeLabel: string;
  /** The UTC day under the time, when the window spans more than one day. */
  dayLabel: string | null;
  place: string;
  placement: string;
  citations: CitationView[];
  sourceNote: string;
};

export type ConsoleCut = {
  slug: string;
  label: string;
  cableName: string;
  owner: string;
  atMs: number;
  timeLabel: string;
  dayLabel: string | null;
  placement: string;
  citations: CitationView[];
  sourceNote: string;
};

export type ConsoleEvent = TimelineEvent & { citations: CitationView[] };

export type ConsoleAftermathStep = { atMs: number; dateLabel: string; title: string; citations: CitationView[]; sourceNote: string };

export type ConsoleCase = {
  slug: string;
  title: string;
  subtitle: string;
  summary: string;
  localTime: { place: string; timeZone: string };
  /** "25 December" or "17 and 18 November" */
  windowDaysLabel: string;
  isMultiDay: boolean;
  vessel: {
    name: string;
    type: string;
    flag: string;
    imo: string | null;
    mmsi: string | null;
    evidence: string;
    evidenceBrief: string;
    citations: CitationView[];
    sourceNote: string;
  };
  recordedTrack: { selection: string; firstFixMs: number; lastFixMs: number; fixCount: number; citations: CitationView[]; sourceNote: string } | null;
  /** What the sources say about the anchor drag itself; empty when the case has no drag window. */
  dragCitations: CitationView[];
  positions: ConsolePosition[];
  cuts: [ConsoleCut, ...ConsoleCut[]];
  events: ConsoleEvent[];
  aftermath: ConsoleAftermathStep[];
  sources: ConsoleSource[];
};

function toCitationView(citation: Citation): CitationView {
  return { sourceId: citation.sourceId, quote: citation.quote, translation: citation.translation ?? null };
}

/** Builds the console's view of a case. */
export function toConsoleCase(cableCase: CableCase): ConsoleCase {
  const windowStartMs = Date.parse(cableCase.window.startUtc);
  const windowEndMs = Date.parse(cableCase.window.endUtc);
  const isMultiDay = !isSameUtcDay(windowStartMs, windowEndMs);
  const dayLabelFor = (atMs: number) => (isMultiDay ? formatUtcDay(atMs) : null);

  // Every place a source is quoted, so its popover can say what it supports.
  const usesBySource = new Map<number, SourceUse[]>();
  const recordUses = (supports: string, citations: readonly Citation[]) => {
    citations.forEach((citation) => {
      const uses = usesBySource.get(citation.sourceId) ?? [];
      uses.push({ supports, quote: citation.quote, translation: citation.translation ?? null });
      usesBySource.set(citation.sourceId, uses);
    });
  };
  recordUses(`The ship: ${cableCase.vessel.name}`, cableCase.vessel.citations);
  cableCase.track.forEach((position) => recordUses(`Position at ${formatUtcClock(Date.parse(position.atUtc))}: ${position.place}`, position.citations));
  if (cableCase.recordedTrack) recordUses("The recorded AIS track", cableCase.recordedTrack.citations);
  if (cableCase.dragWindow) recordUses("When the anchor dragged", cableCase.dragWindow.citations);
  cableCase.cuts.forEach((cut) => recordUses(`${cut.label} cut`, cut.citations));
  cableCase.events.forEach((event) => recordUses(`${formatUtcClock(Date.parse(event.atUtc))}: ${event.title}`, event.citations));
  cableCase.aftermath.forEach((step) => recordUses(`${formatUtcDate(Date.parse(step.atUtc))}: ${step.title}`, step.citations));

  const toConsoleCut = (cut: CableCase["cuts"][number]): ConsoleCut => {
    const atMs = Date.parse(cut.atUtc);
    return {
      slug: toCutSlug(cut.label),
      label: cut.label,
      cableName: cut.cableName,
      owner: cut.owner,
      atMs,
      timeLabel: formatUtcClock(atMs),
      dayLabel: dayLabelFor(atMs),
      placement: cut.placement,
      citations: cut.citations.map(toCitationView),
      sourceNote: formatSourceNote(cut.citations),
    };
  };
  const [primaryCut, ...otherCuts] = cableCase.cuts;
  const eventsByTime = toTimelineEvents(cableCase);
  const citationsByEvent = new Map(cableCase.events.map((event) => [`${Date.parse(event.atUtc)}-${event.title}`, event.citations.map(toCitationView)]));
  const firstFix = cableCase.recordedTrack?.fixes[0];
  const lastFix = cableCase.recordedTrack?.fixes[cableCase.recordedTrack.fixes.length - 1];

  return {
    slug: cableCase.slug,
    title: cableCase.title,
    subtitle: cableCase.subtitle,
    summary: cableCase.summary,
    localTime: cableCase.localTime,
    windowDaysLabel: formatUtcDaySpan(windowStartMs, windowEndMs),
    isMultiDay,
    vessel: {
      name: cableCase.vessel.name,
      type: cableCase.vessel.type,
      flag: cableCase.vessel.flag,
      imo: cableCase.vessel.imo,
      mmsi: cableCase.vessel.mmsi,
      evidence: describeTrackEvidence(cableCase),
      evidenceBrief: describeTrackEvidenceBriefly(cableCase),
      citations: cableCase.vessel.citations.map(toCitationView),
      sourceNote: formatSourceNote(cableCase.vessel.citations),
    },
    recordedTrack:
      cableCase.recordedTrack && firstFix && lastFix
        ? {
            selection: cableCase.recordedTrack.selection,
            firstFixMs: Date.parse(firstFix.atUtc),
            lastFixMs: Date.parse(lastFix.atUtc),
            fixCount: cableCase.recordedTrack.fixes.length,
            citations: cableCase.recordedTrack.citations.map(toCitationView),
            sourceNote: formatSourceNote(cableCase.recordedTrack.citations),
          }
        : null,
    dragCitations: cableCase.dragWindow ? cableCase.dragWindow.citations.map(toCitationView) : [],
    positions: cableCase.track.map((position) => {
      const atMs = Date.parse(position.atUtc);
      return {
        atMs,
        timeLabel: formatUtcClock(atMs),
        dayLabel: dayLabelFor(atMs),
        place: position.place,
        placement: position.placement,
        citations: position.citations.map(toCitationView),
        sourceNote: formatSourceNote(position.citations),
      };
    }),
    cuts: [toConsoleCut(primaryCut), ...otherCuts.map(toConsoleCut)],
    events: eventsByTime.map((event) => ({ ...event, citations: citationsByEvent.get(`${event.atMs}-${event.title}`) ?? [] })),
    aftermath: cableCase.aftermath.map((step) => {
      const atMs = Date.parse(step.atUtc);
      return { atMs, dateLabel: formatUtcDate(atMs), title: step.title, citations: step.citations.map(toCitationView), sourceNote: formatSourceNote(step.citations) };
    }),
    sources: cableCase.sources.map((source) => ({
      id: source.id,
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      archivedUrl: source.archivedUrl,
      publishedLabel: formatPublishedDate(source.publishedOn),
      uses: usesBySource.get(source.id) ?? [],
    })),
  };
}
