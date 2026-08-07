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
      // `/n/:id` is intentionally NOT proxied to the Hono server in dev. That route exists so that,
      // in production, link-unfurling bots get server-rendered OG meta tags (see index.ts) — but the
      // server hands back a plain HTML shell, without Vite's dev-time HTML transform. Proxying it
      // here meant a real browser loading /n/:id (a deep link, or a refresh while on a node page)
      // received a shell missing Vite's client and @vitejs/plugin-react's React Refresh preamble, so
      // the app threw "can't detect preamble" and rendered a blank white page. Letting Vite's own SPA
      // fallback serve index.html for /n/:id gives the fully-transformed shell; the client then
      // hydrates the node via /api. OG tags simply aren't needed against a local dev server.
    },
  },
});
