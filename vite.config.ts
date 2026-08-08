// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const wsGuard: Plugin = {
  name: "ws-guard",
  configureServer(server) {
    server.httpServer?.on("upgrade", (_req, socket) => {
      socket.on("error", () => {});
    });
    const hot = (server as unknown as { hot?: { on?: (ev: string, cb: (ws: unknown) => void) => void } }).hot;
    hot?.on?.("connection", (ws) => {
      (ws as { on?: (ev: string, cb: () => void) => void }).on?.("error", () => {});
    });
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [wsGuard],
});
