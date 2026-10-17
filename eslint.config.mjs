import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase edge functions run on Deno and are checked with deno check, not the Next toolchain.
    "supabase/**",
    // Vendor file copied from node_modules by scripts/copy-maplibre-worker.ts.
    "public/vendor/**",
    // Local-only folders (see .gitignore), including agent worktrees under .claude.
    ".claude/**",
    ".scratch/**",
    "plan/**",
    "ui-design/**",
  ]),
]);

export default eslintConfig;
