import { resolve } from "node:path";

import { defineConfig } from "vite";

const root = resolve(__dirname, "src");

// Popup + MV3 service worker. Both are ES modules so they can share chunks
// (the SDK glue in particular). Content scripts are built separately as IIFEs.
// Shared by the popup and service worker in this build. A mismatch means Chrome is running a
// stale service worker against freshly loaded popup files (e.g. after a rebuild without reload).
const buildId = Date.now().toString(36);

export default defineConfig({
  root,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  base: "",
  publicDir: resolve(__dirname, "public"),
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      // Reused reference helpers (FIDO2 domain validation, CBOR, ECDSA encoding). Only
      // dependency-free modules are imported; tsconfig maps the same path for type-checking.
      "@bitwarden/common": resolve(__dirname, "../../libs/common/src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../../dist/apps/browser-lite"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: process.env.NODE_ENV !== "production",
    // The SDK wasm is copied as-is and streamed in at runtime.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup/index.html"),
        background: resolve(root, "background/index.ts"),
        offscreen: resolve(root, "offscreen/index.html"),
        inline: resolve(root, "inline/menu.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "[name]-[hash].js",
      },
    },
  },
});
