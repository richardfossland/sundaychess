import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` is a Next-provided marker package not resolvable in the
      // plain Node test env — stub it so server modules import under test.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    // The engine specs are NODE-budgeted, not time-budgeted (lib/chess/search.ts):
    // a full default budget takes 5–35 s on a loaded machine, so vitest's 5 s
    // default made `npm run check` red/flaky on main. Give them real headroom.
    testTimeout: 60_000,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
