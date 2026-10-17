import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The recorder and the frame collector run on Deno and reach the registry, src/lib/regions and src/lib/live through
// their deno.json import maps: every "@/" specifier any reached file imports needs an exact entry to its .ts file, or
// the Supabase bundler leaves it unresolved (the same rule as src/lib/detection/module-boundaries.test.ts).

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../..");
const FUNCTIONS = ["record-vessel-positions", "collect-ship-frames"];
const IMPORT_PATTERN = /^\s*import\s+(?:type\s+)?[^;]*?\s+from\s+"([^"]+)";/gm;

function readSpecifiers(filePath: string): string[] {
  return [...readFileSync(filePath, "utf8").matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? "");
}

function readImportMap(functionDir: string): Record<string, string> {
  const config: unknown = JSON.parse(readFileSync(path.join(functionDir, "deno.json"), "utf8"));
  if (typeof config !== "object" || config === null || !("imports" in config) || typeof config.imports !== "object" || config.imports === null) return {};
  return Object.fromEntries(Object.entries(config.imports).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Walks every file the function reaches (relative and "@/" imports) and lists "@/" specifiers without a correct entry. */
function findUnmappedSpecifiers(functionName: string): { missing: string[]; reached: number } {
  const functionDir = path.join(REPOSITORY_ROOT, "supabase/functions", functionName);
  const importMap = readImportMap(functionDir);
  const visitedFiles = new Set<string>();
  const missing = new Set<string>();
  const pending = [path.join(functionDir, "index.ts")];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined || visitedFiles.has(filePath)) continue;
    visitedFiles.add(filePath);
    for (const specifier of readSpecifiers(filePath)) {
      if (specifier.startsWith("@/")) {
        const target = path.join(REPOSITORY_ROOT, "src", `${specifier.slice(2)}.ts`);
        const indexTarget = path.join(REPOSITORY_ROOT, "src", specifier.slice(2), "index.ts");
        const resolved = existsSync(target) ? target : indexTarget;
        const mapped = importMap[specifier];
        if (mapped === undefined || path.resolve(functionDir, mapped) !== resolved || !existsSync(resolved)) missing.add(specifier);
        else pending.push(resolved);
      } else if (specifier.startsWith(".")) {
        pending.push(path.resolve(path.dirname(filePath), specifier));
      }
    }
  }
  return { missing: [...missing].sort(), reached: visitedFiles.size };
}

describe("edge function import maps", () => {
  for (const functionName of FUNCTIONS) {
    test(`${functionName} maps every "@/" module it reaches to its file`, () => {
      const { missing, reached } = findUnmappedSpecifiers(functionName);
      expect(missing).toEqual([]);
      expect(reached).toBeGreaterThan(5);
    });
  }
});
