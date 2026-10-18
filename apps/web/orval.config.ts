import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: "../api/openapi.json",
    output: {
      mode: "tags-split",
      target: "src/api/generated",
      schemas: "src/api/generated/model",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      override: {
        mutator: { path: "src/api/fetcher.ts", name: "apiFetch" },
        fetch: { includeHttpResponseReturnType: false },
        query: { version: 5 },
      },
    },
  },
});
