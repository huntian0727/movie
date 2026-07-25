import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  // Packaged Electron pages are loaded with file://, so renderer assets must
  // resolve relative to dist-renderer/index.html instead of the drive root.
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
