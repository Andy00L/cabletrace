import type { Result } from "@/lib/result";
import type { WatchedLine } from "@/lib/globe/watched-line";
import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

// The lines the /live globe draws: the world's submarine cables and pipelines from OpenStreetMap
// (public/globe/cables.json, built by scripts/globe/build-cables.ts) plus the lines the replays watch (their seabed
// files). Validated where the file enters; three-free, so the page can read it before the renderer arrives.

/** One cable or pipeline. Each part is a flat [longitude, latitude, ...] array in degrees. */
export type GlobeLine = {
  /** Index in the list the viewer was given; picks and passages name a line by it. */
  id: number;
  name: string | null;
  kind: SeabedLineKind;
  /** What a pipeline carries (gas, oil, water), when OpenStreetMap says. */
  substance: string | null;
  operator: string | null;
  parts: number[][];
  /** True for the lines the replays watch: they carry the signal. */
  isWatched: boolean;
};

export type WorldLinesFile = { osmBase: string; lines: Omit<GlobeLine, "id" | "isWatched">[] };

const LINE_KINDS: readonly SeabedLineKind[] = ["power", "telecom", "pipeline"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Undoes the build script's delta encoding: integer units, the first pair absolute and each next one a step. */
function decodePart(encoded: unknown, unitsPerDegree: number): number[] | null {
  if (!Array.isArray(encoded) || encoded.length < 4 || encoded.length % 2 !== 0) return null;
  const points: number[] = [];
  let longitudeUnits = 0;
  let latitudeUnits = 0;
  for (let index = 0; index < encoded.length; index += 2) {
    const longitudeStep = encoded[index];
    const latitudeStep = encoded[index + 1];
    if (!Number.isInteger(longitudeStep) || !Number.isInteger(latitudeStep)) return null;
    longitudeUnits += Number(longitudeStep);
    latitudeUnits += Number(latitudeStep);
    points.push(longitudeUnits / unitsPerDegree, latitudeUnits / unitsPerDegree);
  }
  return points;
}

/** Validates public/globe/cables.json. */
export function parseWorldLines(payload: unknown): Result<WorldLinesFile> {
  if (!isRecord(payload) || !Array.isArray(payload.lines)) return { ok: false, reason: "cable file has no line list" };
  const { unitsPerDegree, osmBase } = payload;
  if (typeof unitsPerDegree !== "number" || !Number.isInteger(unitsPerDegree) || unitsPerDegree <= 0) {
    return { ok: false, reason: "cable file has no coordinate unit" };
  }
  const lines: WorldLinesFile["lines"] = [];
  for (const line of payload.lines) {
    if (!isRecord(line) || !Array.isArray(line.parts) || !LINE_KINDS.some((kind) => kind === line.kind)) {
      return { ok: false, reason: "cable file has a malformed line" };
    }
    const kind = LINE_KINDS.find((lineKind) => lineKind === line.kind) ?? "telecom";
    const parts: number[][] = [];
    for (const part of line.parts) {
      const decoded = decodePart(part, unitsPerDegree);
      if (decoded === null) return { ok: false, reason: "cable file has a malformed line part" };
      parts.push(decoded);
    }
    lines.push({ name: readTextOrNull(line.name), kind, substance: readTextOrNull(line.substance), operator: readTextOrNull(line.operator), parts });
  }
  return { ok: true, value: { osmBase: typeof osmBase === "string" ? osmBase : "unknown", lines } };
}

/**
 * One list for the globe: the world's lines first, then the watched ones. A watched line also mapped in
 * OpenStreetMap appears twice; the watched copy is drawn last, on top.
 */
export function combineGlobeLines(worldLines: WorldLinesFile["lines"], watchedLines: readonly WatchedLine[]): GlobeLine[] {
  const combined: GlobeLine[] = worldLines.map((line, index) => ({ ...line, id: index, isWatched: false }));
  watchedLines.forEach((line) => {
    combined.push({ id: combined.length, name: line.name, kind: line.kind, substance: null, operator: null, parts: [line.points], isWatched: true });
  });
  return combined;
}

const KIND_NOUNS: Readonly<Record<SeabedLineKind, string>> = {
  telecom: "telecom cable",
  power: "power cable",
  pipeline: "pipeline",
};

/** "C-Lion 1", or "Unnamed gas pipeline" when OpenStreetMap gives no name. */
export function describeGlobeLine(line: Pick<GlobeLine, "name" | "kind" | "substance">): string {
  if (line.name !== null) return line.name;
  const noun = KIND_NOUNS[line.kind];
  return line.substance === null ? `Unnamed ${noun}` : `Unnamed ${line.substance} ${noun}`;
}

/** "Telecom cable", "Power cable" or "Gas pipeline". */
export function describeGlobeLineKind(line: Pick<GlobeLine, "kind" | "substance">): string {
  const noun = line.substance === null ? KIND_NOUNS[line.kind] : `${line.substance} ${KIND_NOUNS[line.kind]}`;
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}
