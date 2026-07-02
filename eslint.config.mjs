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
    // Vendored / reference / non-app code (not our source):
    "reference/**",
    "contracts/**",
    "design-system/**",
  ]),
  {
    // `any` is used deliberately at untyped external-data edges (Supabase joins without
    // generated types, loose JSON responses in dev scripts) — advisory, not a hard error.
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
]);

export default eslintConfig;
