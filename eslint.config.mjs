import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);
const reactVersion = require("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react's "detect" path calls context.getFilename(), removed in
  // ESLint 10 (see eslint-plugin-react#4022). Pass the version explicitly —
  // identical result, never enters the removed code path. Delete when the
  // plugin ships an ESLint-10-compatible release.
  { name: "sundaychess/react-version", settings: { react: { version: reactVersion } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated deploy output (OpenNext / Wrangler):
    ".open-next/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
