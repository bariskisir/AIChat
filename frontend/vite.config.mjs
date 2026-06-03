import { defineConfig } from "vite";

// Vite build for the Tauri frontend. Bundles TypeScript + npm dependencies
// (marked, dompurify) and the linked stylesheets into `dist`, which Tauri
// serves as `frontendDist`.
export default defineConfig({
  // Relative asset URLs so the bundle works under Tauri's custom protocol host.
  base: "./",
  clearScreen: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
});
