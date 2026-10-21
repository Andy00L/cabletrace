import type { CaseSketch } from "@/lib/cases/case-sketch";
import type { Result } from "@/lib/result";
import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

// The browser side of /cases/sketches (src/app/cases/sketches/route.ts): every case's sketch by slug, validated once
// where it arrives.

const SKETCHES_URL = "/cases/sketches";
const LINE_KINDS: readonly SeabedLineKind[] = ["power", "telecom", "pipeline"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLineKind(value: unknown): value is SeabedLineKind {
  return LINE_KINDS.some((kind) => kind === value);
}

function parseSketch(value: unknown): CaseSketch | null {
  if (!isRecord(value) || typeof value.landPath !== "string" || typeof value.trackPath !== "string") return null;
  if (!(value.dragPath === null || typeof value.dragPath === "string") || !Array.isArray(value.lines) || !Array.isArray(value.cuts)) return null;
  const lines = value.lines.flatMap((line) => (isRecord(line) && typeof line.path === "string" && isLineKind(line.kind) ? [{ kind: line.kind, path: line.path }] : []));
  const cuts = value.cuts.flatMap((cut) => (isRecord(cut) && typeof cut.x === "number" && typeof cut.y === "number" && typeof cut.label === "string" ? [{ x: cut.x, y: cut.y, label: cut.label }] : []));
  if (lines.length !== value.lines.length || cuts.length !== value.cuts.length) return null;
  return { landPath: value.landPath, lines, trackPath: value.trackPath, dragPath: value.dragPath, cuts };
}

/** Parses the route's answer; a malformed sketch becomes null (its row shows no map), a malformed answer fails. */
export function parseCaseSketches(value: unknown): Result<ReadonlyMap<string, CaseSketch | null>> {
  if (!isRecord(value)) return { ok: false, reason: "the sketches answer is not an object" };
  return { ok: true, value: new Map(Object.entries(value).map(([slug, sketch]) => [slug, sketch === null ? null : parseSketch(sketch)])) };
}

/** Downloads every case's sketch; never throws. */
export async function fetchCaseSketches(): Promise<Result<ReadonlyMap<string, CaseSketch | null>>> {
  try {
    const response = await fetch(SKETCHES_URL);
    if (!response.ok) return { ok: false, reason: `${SKETCHES_URL} answered ${response.status}` };
    return parseCaseSketches(await response.json());
  } catch (error) {
    return { ok: false, reason: `${SKETCHES_URL} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
