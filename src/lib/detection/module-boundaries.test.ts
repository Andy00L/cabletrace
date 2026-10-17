import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The detector runs in three runtimes (Supabase edge function on Deno, the Bun backtest, the browser), so its files
// may import only each other and the Result type. The edge function reaches them through its deno.json import map,
// one exact entry per file: the Supabase CLI bundler skips import specifiers without a file extension.

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../..");
const DETECTION_DIR = path.join(REPOSITORY_ROOT, "src/lib/detection");
const FUNCTION_DIR = path.join(REPOSITORY_ROOT, "supabase/functions/detect-anchor-drag");
const IMPORT_PATTERN = /^\s*import\s+(type\s+)?[^;]*?\s+from\s+"([^"]+)";/gm;

type ImportStatement = { specifier: string; isTypeOnly: boolean };

function readImports(filePath: string): ImportStatement[] {
  const source = readFileSync(filePath, "utf8");
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => ({ specifier: match[2] ?? "", isTypeOnly: match[1] !== undefined }));
}

function readImportMap(): Record<string, string> {
  const config: unknown = JSON.parse(readFileSync(path.join(FUNCTION_DIR, "deno.json"), "utf8"));
  if (typeof config !== "object" || config === null || !("imports" in config) || typeof config.imports !== "object" || config.imports === null) return {};
  return Object.fromEntries(Object.entries(config.imports).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
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

  test("every @/ module the edge function reaches has an exact import map entry to its .ts file", () => {
    const importMap = readImportMap();
    const visited = new Set<string>();
    const missing: string[] = [];
    const pending = readImports(path.join(FUNCTION_DIR, "index.ts")).map((statement) => statement.specifier);
    while (pending.length > 0) {
      const specifier = pending.pop();
      if (specifier === undefined || !specifier.startsWith("@/") || visited.has(specifier)) continue;
      visited.add(specifier);
      const expectedTarget = `../../../src/${specifier.slice(2)}.ts`;
      const sourceFile = path.join(REPOSITORY_ROOT, "src", `${specifier.slice(2)}.ts`);
      if (importMap[specifier] !== expectedTarget || !existsSync(sourceFile)) {
        missing.push(specifier);
        continue;
      }
      pending.push(...readImports(sourceFile).map((statement) => statement.specifier));
    }
    expect(missing).toEqual([]);
    expect(visited.size).toBeGreaterThan(5);
  });
});
