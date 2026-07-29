import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor loads from the filesystem, so assets must be referenced relatively.
  base: "./",
  build: { target: "esnext", outDir: "dist", sourcemap: true },
  server: {
    host: true,          // lets you test on your phone over wifi
    /* A port of our own, and strictPort so Vite FAILS rather than quietly
       moving. Two other projects on this machine hold 5173 and 5174, and the
       silent fallback meant a phone pointed at :5173 loaded a different app
       entirely — which looked like "the proxy is broken" because /api there is
       somebody else's server. Fail loudly and the URL stays true. */
    port: 5180,
    strictPort: true,
    // The private Clover token lives on the proxy, never in this bundle.
    // If the proxy isn't running the app falls back to preview mode rather
    // than erroring, so `npm run dev` alone is still useful for menu work.
    proxy: {
      /* Vite proxies this server-side, so it already works from any device on
         the network — the phone talks to Vite, Vite talks to 3001. */
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false,
    // Several tests render the whole app — 43 menu rows, sheets, polling hooks —
    // and drive it through userEvent. Under parallel workers that overruns the
    // 5s default often enough to make the suite flaky, which is worse than slow.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
