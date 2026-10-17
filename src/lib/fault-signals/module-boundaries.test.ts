import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The fault-signal code runs in three runtimes (the match-fault-signals edge function on Deno, the replay script on Bun,
// the browser), so its files may import only each other, the detector (src/lib/detection, held to the same rule) and
// the Result type. The edge function reaches them through its deno.json import map, one exact entry per file: the
// Supabase CLI bundler skips import specifiers without a file extension. Same checks as
// src/lib/detection/module-boundaries.test.ts, for this folder and its function.

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../..");
const FAULT_SIGNALS_DIR = path.join(REPOSITORY_ROOT, "src/lib/fault-signals");
const FUNCTION_DIR = path.join(REPOSITORY_ROOT, "supabase/functions/match-fault-signals");
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

function isAllowed(statement: ImportStatement): boolean {
  if (statement.specifier.startsWith("@/lib/fault-signals/") || statement.specifier.startsWith("@/lib/detection/")) return true;
  return statement.isTypeOnly && statement.specifier === "@/lib/result";
}

describe("fault-signal module boundaries", () => {
  const runtimeFiles = readdirSync(FAULT_SIGNALS_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

  test("runtime files import only fault-signal and detection modules and the Result type", () => {
    const offending = runtimeFiles.flatMap((name) =>
      readImports(path.join(FAULT_SIGNALS_DIR, name))
        .filter((statement) => !isAllowed(statement))
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
    expect(visited.size).toBeGreaterThan(15);
  });
});
