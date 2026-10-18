# 01: Walking skeleton — catalog end to end

**What to build:** Opening the SPA shows the seeded product catalog (name, price, available stock), served by the Effect API from SQLite, through orval-generated hooks built from the committed OpenAPI document. This ticket proves the whole toolchain works together end to end: pnpm workspaces, Vite+, Effect 4 HTTP API and SQL, `node:sqlite`, OpenAPI emission, orval, Tailwind v4, shadcn, and CI. It also establishes the test harness that later tickets reuse. See SPEC.md (Implementation Decisions → Repository and tooling, Configuration, Persistence; Testing Decisions → Prior art).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Monorepo with an API app, a web app, and a shared TypeScript config package; pnpm workspaces; Vite+ as task runner, linter/formatter and test runner; Node 24 pinned
- [x] API reads `n`, `x` and the database path from the environment with validation (n ≥ 1, 1 ≤ x ≤ 100, defaults 5 and 10) and refuses to start on invalid values
- [x] Numbered migrations run on startup; the products table has a non-negative inventory check constraint
- [x] An idempotent seed inserts six products only when the catalog is empty, including one with stock 3 and one priced at 1999 cents
- [x] A reset command restores the seeded state
- [x] `GET /api/products` returns every product with id, name, `unitPriceCents` and available inventory; all money is integer cents
- [x] The shared error body (`code`, `message`, `details`) and the `VALIDATION_ERROR` mapping (400) are in place for later endpoints to use
- [x] The OpenAPI 3.1 document is generated from the API definition and committed; interactive docs are served under `/api/docs`
- [x] A drift test fails when the committed OpenAPI document differs from the one generated from code
- [x] A per-test layer provides a fresh in-memory database, migrated and seeded through the same layer the server uses, plus an HTTP test client; one catalog test uses it
- [x] The web app regenerates orval TanStack Query v5 hooks from the committed spec before dev and build; generated code is git-ignored
- [x] Tailwind v4 and shadcn work under Vite+ (this is the open risk in SPEC.md; record any workaround in DECISIONS.md)
- [x] The catalog page renders the products using a generated hook
- [x] One root command runs both apps, with the web dev server proxying `/api` (no CORS)
- [x] A CI workflow runs check, test and the drift test
- [x] `git init` done, with a meaningful first commit; `DECISIONS.md` started with the stack, persistence and repo-shape decisions
