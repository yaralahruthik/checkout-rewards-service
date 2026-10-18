import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "SPEC.md",
      ".scratch/**",
      "apps/api/openapi.json",
      "apps/web/src/api/generated/**",
      "pnpm-lock.yaml",
    ],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["apps/web/src/api/generated/**"],
    overrides: [
      {
        files: ["apps/web/**"],
        plugins: ["react"],
      },
    ],
  },
  test: {
    projects: ["apps/api"],
  },
});
