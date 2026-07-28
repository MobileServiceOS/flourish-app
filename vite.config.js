import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor loads from the filesystem, so assets must be referenced relatively.
  base: "./",
  build: { target: "esnext", outDir: "dist", sourcemap: true },
  server: { host: true, port: 5173 },   // host:true lets you test on your phone over wifi
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false,
  },
});
