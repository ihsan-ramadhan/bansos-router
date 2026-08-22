import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
  ],
  root: path.resolve(__dirname, "src/ui"),
  publicDir: path.resolve(__dirname, "src/ui/public"),
  build: {
    outDir: path.resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:17070",
      "/bansos": "http://127.0.0.1:17070",
      "/healthz": "http://127.0.0.1:17070",
    },
  },
});
