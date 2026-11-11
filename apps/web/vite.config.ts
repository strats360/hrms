import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Stamp the service worker with a build id, so each deploy is picked up as an update. */
function serviceWorkerVersion(): Plugin {
  let names: string[] = [];
  return {
    name: "sw-version",
    apply: "build",
    generateBundle(_o, bundle) {
      names = Object.keys(bundle).sort();
    },
    closeBundle() {
      const file = fileURLToPath(new URL("./dist/sw.js", import.meta.url));
      const id = createHash("sha256").update(names.join("|")).digest("hex").slice(0, 12);
      writeFileSync(file, readFileSync(file, "utf8").replace("__BUILD_ID__", id));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerVersion()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
});
