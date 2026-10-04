import { resolve } from "node:path";

import { defineConfig } from "vite";

/**
 * Content scripts are injected as classic scripts, so each must be a single self-contained IIFE
 * with no imports. IIFE builds take one entry, so each script is its own build: the default mode
 * builds the on-demand autofill script, `--mode inline` the inline-menu script. Keep both tiny:
 * the inline one runs on every page while the feature is on.
 */
const ENTRIES: Record<string, { file: string; name: string }> = {
  autofill: { file: "autofill", name: "bwLiteAutofill" },
  inline: { file: "inline", name: "bwLiteInline" },
  "webauthn-page": { file: "webauthn-page", name: "bwLiteWebAuthnPage" },
  "webauthn-bridge": { file: "webauthn-bridge", name: "bwLiteWebAuthnBridge" },
};

export default defineConfig(({ mode }) => {
  const entry = ENTRIES[mode] ?? ENTRIES.autofill;
  return {
    build: {
      outDir: resolve(__dirname, "../../dist/apps/browser-lite/content"),
      emptyOutDir: false,
      target: "chrome120",
      minify: true,
      lib: {
        entry: resolve(__dirname, `src/content/${entry.file}.ts`),
        name: entry.name,
        formats: ["iife"],
        fileName: () => `${entry.file}.js`,
      },
    },
  };
});
