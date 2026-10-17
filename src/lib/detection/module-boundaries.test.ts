import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The detector runs in three runtimes (Supabase edge function on Deno, the Bun backtest, the browser), so its files
// may import only each other and the Result type. The edge function's import map is checked with the other
// functions' (src/lib/regions/module-boundaries.test.ts).

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../..");
const DETECTION_DIR = path.join(REPOSITORY_ROOT, "src/lib/detection");
const IMPORT_PATTERN = /^\s*import\s+(type\s+)?[^;]*?\s+from\s+"([^"]+)";/gm;

type ImportStatement = { specifier: string; isTypeOnly: boolean };

function readImports(filePath: string): ImportStatement[] {
  const source = readFileSync(filePath, "utf8");
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => ({ specifier: match[2] ?? "", isTypeOnly: match[1] !== undefined }));
}

describe("detection module boundaries", () => {
  const runtimeFiles = readdirSync(DETECTION_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

  test("runtime files import only detection modules and the Result type", () => {
    const offending = runtimeFiles.flatMap((name) =>
      readImports(path.join(DETECTION_DIR, name))
        .filter((statement) => !statement.specifier.startsWith("@/lib/detection/") && !(statement.isTypeOnly && statement.specifier === "@/lib/result"))
        .map((statement) => `${name}: ${statement.specifier}`),
    );
    expect(offending).toEqual([]);
  });
});
