import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Forge serves the build from a sub-path, so assets must use relative URLs.
// `--mode mock` swaps @forge/bridge for a simulated Confluence site (local QA only).
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  resolve: mode === "mock"
    ? { alias: { "@forge/bridge": fileURLToPath(new URL("./src/mock/bridge.ts", import.meta.url)) } }
    : undefined,
  // The sorting engine lives in ../../src/core, shared with the trigger function.
  server: { fs: { allow: ["../.."] } },
  build: { outDir: "dist", sourcemap: false },
}));
