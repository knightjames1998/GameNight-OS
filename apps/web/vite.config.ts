import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Namespaces the client cache (src/cache.ts). Every cached key is prefixed
 * with this, so a deploy cannot let an object written by the previous build
 * hydrate into new code that expects a different shape. That failure is a
 * white screen on launch for exactly the people who use the app most, since
 * they are the ones with a warm cache. The trade is a cold cache after each
 * deploy, which is the cheap side of the bargain.
 *
 * Date.now() at build time is enough: it changes on every build, which is the
 * only property required. A git SHA would be prettier but is not available
 * during Render's build without extra plumbing.
 */
const BUILD_ID = String(Date.now());

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
