import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // "server-only" throws unless it is resolved under the react-server
      // condition, which Vitest does not apply. Server modules are plain
      // TypeScript here, so the marker is replaced with the package's own
      // empty build rather than skipping those tests.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
