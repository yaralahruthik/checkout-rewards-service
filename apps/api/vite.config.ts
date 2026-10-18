import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // @effect/vitest imports `vitest`; pnpm installs it as a separate copy from
    // the one `vp test` runs, which breaks Vitest's runner state. Inline it so
    // its import resolves through the alias to the bundled runner.
    server: { deps: { inline: ["@effect/vitest"] } },
    alias: { vitest: "vite-plus/test" },
  },
});
