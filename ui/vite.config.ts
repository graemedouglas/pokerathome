import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@pokerathome/schema": path.resolve(__dirname, "../schema/src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    open: true,
    proxy: {
      "/ws": {
        target: "ws://0.0.0.0:3000",
        ws: true,
      },
    },
  },
});
