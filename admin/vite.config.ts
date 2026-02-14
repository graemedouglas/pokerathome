import { defineConfig } from "vite";

export default defineConfig({
  // BASE_PATH is set during Docker builds (e.g. /admin/) — defaults to / for local dev
  base: process.env.BASE_PATH || "/",
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "/api": "http://0.0.0.0:3000",
    },
  },
});
