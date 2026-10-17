// Readers for untrusted JSON, shared by the parsers in this folder: each answers null instead of guessing.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Trimmed text, or null for anything else or an empty string. */
export function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** An ISO 8601 time as epoch milliseconds, or null when it does not parse. */
export function readIsoTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}
