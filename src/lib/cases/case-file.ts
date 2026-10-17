import type { ReplayCut, ReplaySceneInput, TimedPosition } from "@/lib/replay/replay-scene";

// A curated incident. Every time, position and claim points at a published source with its quote, so the
// case can be checked line by line. Cases live as typed data in src/data/cases (reviewed in pull requests).

export type CaseSource = {
  id: number;
  publisher: string;
  title: string;
  url: string;
  /** YYYY-MM-DD. */
  publishedOn: string;
};

export type Citation = {
  sourceId: number;
  /** Verbatim, one or two sentences. */
  quote: string;
  /** English translation when the quote is not in English. */
  translation?: string;
};

/** How exactly a source places something: printed coordinates, a named place, or a description of an area. */
export type PositionPrecision = "coordinates" | "named-place" | "area";

/**
 * How the case knows where the vessel was: positions taken from statements ("reconstruction") or recorded
 * AIS reports ("ais"). The UI labels a reconstruction everywhere it appears.
 */
export type TrackEvidence = "reconstruction" | "ais";

export type CasePosition = {
  /** ISO 8601 UTC. */
  atUtc: string;
  longitude: number;
  latitude: number;
  precision: PositionPrecision;
  place: string;
  citations: Citation[];
};

export type CaseCut = {
  /** Matches a line name in the seabed file. */
  cableName: string;
  label: string;
  owner: string;
  atUtc: string;
  longitude: number;
  latitude: number;
  precision: PositionPrecision;
  citations: Citation[];
};

export type CaseEventKind = "departure" | "anchor" | "cable-fault" | "authorities" | "investigation";

export type CaseEvent = {
  atUtc: string;
  /** True when the source gives only a part of the day or an hour range. */
  isTimeApproximate: boolean;
  kind: CaseEventKind;
  title: string;
  citations: Citation[];
};

export type CableCase = {
  slug: string;
  title: string;
  subtitle: string;
  /** Two or three sentences shown above the replay. */
  summary: string;
  trackEvidence: TrackEvidence;
  vessel: { name: string; flag: string; type: string; imo: string | null; mmsi: string | null; citations: Citation[] };
  window: { startUtc: string; endUtc: string };
  seabedArea: string;
  track: CasePosition[];
  dragWindow: { startUtc: string; endUtc: string; citations: Citation[] } | null;
  cuts: [CaseCut, ...CaseCut[]];
  events: CaseEvent[];
  sources: CaseSource[];
};

function toMs(isoUtc: string): number {
  return Date.parse(isoUtc);
}

/** The numbers the 3D replay needs, without sources or quotes. */
export function toReplaySceneInput(cableCase: CableCase): ReplaySceneInput {
  const track: TimedPosition[] = cableCase.track
    .map((position) => ({ atMs: toMs(position.atUtc), longitude: position.longitude, latitude: position.latitude }))
    .sort((first, second) => first.atMs - second.atMs);
  const toCut = (cut: CaseCut): ReplayCut => ({ cableName: cut.cableName, label: cut.label, atMs: toMs(cut.atUtc), longitude: cut.longitude, latitude: cut.latitude });
  const [primaryCut, ...otherCuts] = cableCase.cuts;
  return {
    seabedArea: cableCase.seabedArea,
    windowStartMs: toMs(cableCase.window.startUtc),
    windowEndMs: toMs(cableCase.window.endUtc),
    track,
    dragWindow: cableCase.dragWindow ? { startMs: toMs(cableCase.dragWindow.startUtc), endMs: toMs(cableCase.dragWindow.endUtc) } : null,
    cuts: [toCut(primaryCut), ...otherCuts.map(toCut)],
    vessel: { name: cableCase.vessel.name, note: cableCase.trackEvidence === "reconstruction" ? "reconstructed position" : "AIS position" },
  };
}

/**
 * Checks a case for the mistakes that would mislead a reader: unparseable times, citations pointing at
 * missing sources, a window that does not contain the events, an unsorted track. Returns every problem found.
 */
export function findCaseProblems(cableCase: CableCase): string[] {
  const problems: string[] = [];
  const sourceIds = new Set(cableCase.sources.map((source) => source.id));
  const windowStart = toMs(cableCase.window.startUtc);
  const windowEnd = toMs(cableCase.window.endUtc);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) problems.push("window: start must be a valid time before end");

  const checkCitations = (label: string, citations: Citation[]) => {
    if (citations.length === 0) problems.push(`${label}: no citation`);
    citations.forEach((citation) => {
      if (!sourceIds.has(citation.sourceId)) problems.push(`${label}: cites missing source ${citation.sourceId}`);
      if (citation.quote.trim() === "") problems.push(`${label}: empty quote`);
    });
  };
  const checkTime = (label: string, isoUtc: string) => {
    const atMs = toMs(isoUtc);
    if (!Number.isFinite(atMs)) problems.push(`${label}: time "${isoUtc}" does not parse`);
    else if (atMs < windowStart || atMs > windowEnd) problems.push(`${label}: ${isoUtc} is outside the replay window`);
  };

  checkCitations("vessel", cableCase.vessel.citations);
  cableCase.track.forEach((position, index) => {
    checkTime(`track ${index}`, position.atUtc);
    checkCitations(`track ${index}`, position.citations);
    const previous = cableCase.track[index - 1];
    if (previous && toMs(previous.atUtc) > toMs(position.atUtc)) problems.push(`track ${index}: earlier than the position before it`);
  });
  cableCase.cuts.forEach((cut) => {
    checkTime(`cut ${cut.label}`, cut.atUtc);
    checkCitations(`cut ${cut.label}`, cut.citations);
  });
  cableCase.events.forEach((event) => {
    checkTime(`event "${event.title}"`, event.atUtc);
    checkCitations(`event "${event.title}"`, event.citations);
  });
  if (cableCase.dragWindow) checkCitations("drag window", cableCase.dragWindow.citations);
  return problems;
}
