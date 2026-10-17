import type { CableCase } from "@/lib/cases/case-file";
import type { Result } from "@/lib/result";

// A case as a downloadable file a reader can check. The file carries the case (every position, quote, source and
// archived copy) and the SHA-256 of its canonical form: the case serialized with every object's keys sorted and no
// whitespace, so the same case always gives the same bytes whatever the file's own formatting. Anyone can recompute
// the hash (scripts/cases/verify-case-file.ts does) and see that nothing was altered after export.

export const CASE_FILE_FORMAT = "cabletrace-case/1";

export type CaseFileExport = {
  format: typeof CASE_FILE_FORMAT;
  slug: string;
  /** How the hash is computed, written into the file so a reader needs nothing else. */
  hashMethod: string;
  contentSha256: string;
  case: CableCase;
};

const HASH_METHOD =
  "SHA-256, hex, of the `case` value serialized as JSON with the keys of every object sorted by UTF-16 code unit and no whitespace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with every object's keys sorted and no whitespace. Keys whose value is undefined are left out, as in JSON. */
export function toCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : toCanonicalJson(item))).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => (value[key] === undefined ? [] : [`${JSON.stringify(key)}:${toCanonicalJson(value[key])}`]));
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hex SHA-256 of a text's UTF-8 bytes, with the Web Crypto API (the same in the browser, Bun, Node and Deno). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCaseFileExport(cableCase: CableCase): Promise<CaseFileExport> {
  return { format: CASE_FILE_FORMAT, slug: cableCase.slug, hashMethod: HASH_METHOD, contentSha256: await sha256Hex(toCanonicalJson(cableCase)), case: cableCase };
}

export type CaseFileCheck = { slug: string; recordedSha256: string; computedSha256: string; isIntact: boolean };

/** Recomputes the hash of an exported case file and compares it with the one the file records. */
export async function verifyCaseFileExport(payload: unknown): Promise<Result<CaseFileCheck>> {
  if (!isRecord(payload)) return { ok: false, reason: "the file is not a JSON object" };
  if (payload.format !== CASE_FILE_FORMAT) return { ok: false, reason: `the file's format is ${String(payload.format)}, not ${CASE_FILE_FORMAT}` };
  if (typeof payload.slug !== "string" || typeof payload.contentSha256 !== "string" || !isRecord(payload.case)) {
    return { ok: false, reason: "the file has no slug, recorded hash or case" };
  }
  const computedSha256 = await sha256Hex(toCanonicalJson(payload.case));
  return { ok: true, value: { slug: payload.slug, recordedSha256: payload.contentSha256, computedSha256, isIntact: computedSha256 === payload.contentSha256 } };
}
