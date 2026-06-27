import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The Irys browser SDK assumes a Node-ish runtime (Buffer / process / stream).
// vite-plugin-node-polyfills shims those so the bundle boots in the browser.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  // Serve on the `localhost` origin (Privy allows it). 127.0.0.1 is a *different*
  // origin and Privy login is rejected there — keep host + launcher both localhost.
  server: { port: 5173, host: "localhost", strictPort: true },
  preview: { port: 4173, host: "localhost" },
  build: { target: "es2022", sourcemap: true },
});
