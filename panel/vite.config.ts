import { defineConfig } from "vite";
import { rackPlugin } from "../tools/owner-gate.mjs";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Dev server: 127.0.0.1:8080. Pass --host to change it.
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "127.0.0.1", port: 8080, strictPort: true, proxy: { "/engine": { target: `http://127.0.0.1:${process.env.RACK_API_PORT || "8797"}`, rewrite: (path) => path.replace(/^\/engine/, "") } } },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    rackPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview ? [nitro()] : []),
    viteReact(),
  ],
}));
