import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // Same-origin in development: the SPA calls /api/* and Vite forwards it,
    // so the API needs no CORS configuration.
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
