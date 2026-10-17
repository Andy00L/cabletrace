import type { ReplayCut, ReplaySceneInput, ShipKind, TimedPosition } from "@/lib/replay/replay-scene";

// A curated incident. Every time, position and claim points at a published source with its quote, so the
// case can be checked line by line. Cases live as typed data in src/data/cases (reviewed in pull requests).

export type CaseSource = {
  id: number;
  publisher: string;
  title: string;
  url: string;
  /** YYYY-MM-DD. */
  publishedOn: string;
  /** A Wayback Machine capture of `url` (https://web.archive.org/web/...), or null when none exists. */
  archivedUrl: string | null;
};

// Every archived copy is a Wayback Machine capture, so a reader can open the page as it was when cited.
const WAYBACK_PREFIX = "https://web.archive.org/web/";

export type Citation = {
  sourceId: number;
  /** Verbatim, one or two sentences. */
  quote: string;
  /** English translation when the quote is not in English. */
  translation?: string;
};

/** How exactly a source places something: printed coordinates, a named place, or a description of an area. */
export type PositionPrecision = "coordinates" | "named-place" | "area";

export type CasePosition = {
  /** ISO 8601 UTC. */
  atUtc: string;
  longitude: number;
  latitude: number;
  precision: PositionPrecision;
  /** The place as the sources describe it. */
  place: string;
  /** How the coordinate was derived from that description, so a reader can redo it. */
  placement: string;
  citations: Citation[];
};

/** One AIS report as the archive row gives it: time, position and speed over ground. */
export type AisFix = { atUtc: string; longitude: number; latitude: number; speedKnots: number };

/**
 * Positions the vessel itself broadcast, from a public archive. `selection` says which rows were kept (vessel,
 * time span, sampling) so a reader can rebuild the list from the same file.
 */
export type RecordedTrack = { selection: string; citations: Citation[]; fixes: AisFix[] };

export type CaseCut = {
  /** Matches a line name in the seabed file. */
  cableName: string;
  label: string;
  owner: string;
  atUtc: string;
  longitude: number;
  latitude: number;
  precision: PositionPrecision;
  /** How the coordinate was derived from the published description. */
  placement: string;
  citations: Citation[];
};

export type CaseEventKind = "vessel" | "anchor" | "cable-fault" | "repair" | "authorities" | "investigation" | "court";

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
  /**
   * `kind` picks the 3D model; `type` is the description shown on the ship card. `lengthMetres` is the length
   * overall from the ship's registry entry or AIS dimensions (the same figure `type` states), and sizes its hull.
   */
  vessel: { name: string; kind: ShipKind; flag: string; type: string; lengthMetres: number; imo: string | null; mmsi: string | null; citations: Citation[] };
  window: { startUtc: string; endUtc: string };
  /** The local clock shown beside UTC, for the place the incident happened. */
  localTime: { place: string; timeZone: string };
  seabedArea: string;
  /** Positions placed from statements, each saying how (a reconstruction). The UI labels them everywhere. */
  track: CasePosition[];
  /** AIS positions from a public archive, or null when none survive for the window. */
  recordedTrack: RecordedTrack | null;
  dragWindow: { startUtc: string; endUtc: string; citations: Citation[] } | null;
  cuts: [CaseCut, ...CaseCut[]];
  /** What happened inside the replay window. */
  events: CaseEvent[];
  /** What followed: recovery, investigation and court steps, after the window. */
  aftermath: CaseEvent[];
  sources: CaseSource[];
};

function toMs(isoUtc: string): number {
  return Date.parse(isoUtc);
}

/** The numbers the 3D replay needs, without sources or quotes. Placed and recorded positions share one track. */
export function toReplaySceneInput(cableCase: CableCase): ReplaySceneInput {
  const placedPositions: TimedPosition[] = cableCase.track.map((position) => ({
    atMs: toMs(position.atUtc),
    longitude: position.longitude,
    latitude: position.latitude,
    recordedSpeedKnots: null,
  }));
  const recordedPositions: TimedPosition[] = (cableCase.recordedTrack?.fixes ?? []).map((fix) => ({
    atMs: toMs(fix.atUtc),
    longitude: fix.longitude,
    latitude: fix.latitude,
    recordedSpeedKnots: fix.speedKnots,
  }));
  const track = [...placedPositions, ...recordedPositions].sort((first, second) => first.atMs - second.atMs);
  const toCut = (cut: CaseCut): ReplayCut => ({ cableName: cut.cableName, label: cut.label, atMs: toMs(cut.atUtc), longitude: cut.longitude, latitude: cut.latitude });
  const [primaryCut, ...otherCuts] = cableCase.cuts;
  return {
    seabedArea: cableCase.seabedArea,
    windowStartMs: toMs(cableCase.window.startUtc),
    windowEndMs: toMs(cableCase.window.endUtc),
    track,
    placements: cableCase.track.map((position) => ({ longitude: position.longitude, latitude: position.latitude })),
    dragWindow: cableCase.dragWindow ? { startMs: toMs(cableCase.dragWindow.startUtc), endMs: toMs(cableCase.dragWindow.endUtc) } : null,
    cuts: [toCut(primaryCut), ...otherCuts.map(toCut)],
    vessel: { name: cableCase.vessel.name, kind: cableCase.vessel.kind, lengthMetres: cableCase.vessel.lengthMetres },
  };
}

/**
 * Checks a case for the mistakes that would mislead a reader: unparseable times, citations pointing at
 * missing sources, a window that does not contain the events, aftermath inside the window, an unsorted track
 * or list of AIS fixes, a source id used twice, an archived copy that is not a dated snapshot of the cited page.
 * Returns every problem found.
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
  cableCase.aftermath.forEach((event) => {
    if (!Number.isFinite(toMs(event.atUtc))) problems.push(`aftermath "${event.title}": time "${event.atUtc}" does not parse`);
    else if (toMs(event.atUtc) < windowEnd) problems.push(`aftermath "${event.title}": ${event.atUtc} is not after the replay window`);
    checkCitations(`aftermath "${event.title}"`, event.citations);
  });
  if (cableCase.recordedTrack) {
    const { fixes, citations } = cableCase.recordedTrack;
    checkCitations("recorded track", citations);
    if (fixes.length === 0) problems.push("recorded track: no fixes");
    fixes.forEach((fix, index) => {
      checkTime(`fix ${index}`, fix.atUtc);
      const previous = fixes[index - 1];
      if (previous && toMs(previous.atUtc) > toMs(fix.atUtc)) problems.push(`fix ${index}: earlier than the fix before it`);
    });
  }
  if (cableCase.dragWindow) checkCitations("drag window", cableCase.dragWindow.citations);

  // An archived copy must be a dated snapshot of the cited page itself, taken no earlier than the page: a Wayback
  // Machine capture (https://web.archive.org/web/<YYYYMMDDhhmmss>/<original>) or an archive.today snapshot (a short
  // id, or <YYYY.MM.DD-hhmmss>/<original>). Whether each one still answers is checked over the network by
  // scripts/cases/check-sources.ts.
  const waybackCapture = /^(\d{4})(\d{2})(\d{2})\d{6}\/(https?:\/\/\S+)$/;
  const archiveTodaySnapshot = /^https:\/\/archive\.(?:today|ph|is|li|vn|fo|md)\/(?:[A-Za-z0-9]{4,10}|(\d{4})\.(\d{2})\.(\d{2})-\d{6}\/(https?:\/\/\S+))$/;
  // Scheme, a leading "www.", a trailing slash, the fragment (archives never store it) and the case of percent-escapes
  // (%2c is %2C, RFC 3986 section 2.1) differ between a page and its capture without changing which page it is.
  const toComparableUrl = (url: string) =>
    url
      .replace(/#.*$/, "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
  // `publishedOn` is a local date; a page published just after midnight in Europe or Asia is the previous UTC day.
  const publicationSlackMs = 24 * 60 * 60 * 1000;
  const seenSourceIds = new Set<number>();
  cableCase.sources.forEach((source) => {
    if (seenSourceIds.has(source.id)) problems.push(`source ${source.id}: id used twice`);
    seenSourceIds.add(source.id);
    if (source.archivedUrl === null) return;
    const capture = source.archivedUrl.startsWith(WAYBACK_PREFIX) ? waybackCapture.exec(source.archivedUrl.slice(WAYBACK_PREFIX.length)) : archiveTodaySnapshot.exec(source.archivedUrl);
    if (!capture) {
      problems.push(`source ${source.id}: archived copy is not a Wayback Machine or archive.today snapshot`);
      return;
    }
    const [, year, month, day, capturedUrl] = capture;
    if (capturedUrl !== undefined && toComparableUrl(capturedUrl) !== toComparableUrl(source.url)) problems.push(`source ${source.id}: archived copy is a snapshot of ${capturedUrl}, not of the cited page`);
    const capturedOnMs = year === undefined ? Number.NaN : Date.parse(`${year}-${month}-${day}T00:00:00Z`);
    if (capturedOnMs + publicationSlackMs < toMs(`${source.publishedOn}T00:00:00Z`)) problems.push(`source ${source.id}: archived copy from ${year}-${month}-${day} predates the page (${source.publishedOn})`);
  });
  return problems;
}
