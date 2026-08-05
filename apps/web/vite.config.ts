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
      "/n": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
