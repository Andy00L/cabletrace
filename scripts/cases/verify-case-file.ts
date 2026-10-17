// Checks that a CableTrace case file was not altered after export: recomputes the SHA-256 of its canonical case
// (src/lib/cases/case-export.ts) and compares it with the hash the file records.
// Usage: bun scripts/cases/verify-case-file.ts <path to the .json file, or its https URL>
// Exit codes: 0 intact, 1 altered, 2 the file could not be read.
import { readFile } from "node:fs/promises";
import { verifyCaseFileExport } from "../../src/lib/cases/case-export";
import type { Result } from "../../src/lib/result";

async function readText(location: string): Promise<Result<string>> {
  try {
    if (/^https:\/\//.test(location)) {
      const response = await fetch(location, { signal: AbortSignal.timeout(30_000) });
      return response.ok ? { ok: true, value: await response.text() } : { ok: false, reason: `${location} answered ${response.status}` };
    }
    return { ok: true, value: await readFile(location, "utf8") };
  } catch (error) {
    return { ok: false, reason: `${location}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main(): Promise<number> {
  const location = process.argv[2];
  if (!location) {
    console.error("[verifyCaseFile] pass a case file path or URL");
    return 2;
  }
  const text = await readText(location);
  if (!text.ok) {
    console.error(`[verifyCaseFile] ${text.reason}`);
    return 2;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text.value);
  } catch {
    console.error("[verifyCaseFile] the file is not JSON");
    return 2;
  }
  const check = await verifyCaseFileExport(payload);
  if (!check.ok) {
    console.error(`[verifyCaseFile] ${check.reason}`);
    return 2;
  }
  const { slug, recordedSha256, computedSha256, isIntact } = check.value;
  console.log(`[verifyCaseFile] ${slug}: recorded ${recordedSha256}`);
  console.log(`[verifyCaseFile] ${slug}: computed ${computedSha256}`);
  console.log(isIntact ? `[verifyCaseFile] ${slug}: intact` : `[verifyCaseFile] ${slug}: ALTERED, the hashes differ`);
  return isIntact ? 0 : 1;
}

process.exit(await main());
