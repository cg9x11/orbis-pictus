import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/images": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      // Server-rendered so it can inject OG meta tags for link unfurling (see index.ts).
      // Must be the regex `^/n/`, never the plain string "/n": Vite matches a non-regex proxy key
      // with `url.startsWith(context)`, so "/n" also captures every `/node_modules/...` request —
      // including the optimizer's `/node_modules/.vite/deps/react.js` — and forwards them to the
      // Hono server, which answers with its SPA index.html. The browser then rejects those as
      // modules ("Expected a JavaScript-or-Wasm module script but the server responded with a MIME
      // type of text/html") and the dev server appears to hang on dependency pre-bundling.
      "^/n/": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
