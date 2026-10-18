# Decisions

This file is written incrementally as the service is built. Sections for invariants, concurrency, money, errors, coupons, scale-out and AI usage are added by the tickets that introduce them.

## Decision: Stack — Effect 4 HTTP API on Node 24, React SPA

**Context:** The assignment is about predictable behaviour under retries and concurrency, plus an API contract an evaluator can explore. The stack should make errors, transactions and the contract explicit without much hand-written glue.

**Options considered:**

- Express or Fastify with Zod and a hand-maintained OpenAPI file.
- NestJS.
- Effect 4 (`effect/http-api`, `effect/sql`) with `@effect/platform-node` and `@effect/sql-sqlite-node`.

**Choice:** Effect 4.0.5. Request, response and error shapes are Effect Schemas declared once in the API definition (`apps/api/src/Api.ts`). They drive request validation, response encoding, typed errors and the OpenAPI 3.1 document. A thin React SPA (Tailwind v4, shadcn, TanStack Query v5) demonstrates the backend.

**Why:**

- Errors are part of every function's type, so each failure has to be mapped to an HTTP status and code before the code compiles.
- Transactions are scoped effects (`sql.withTransaction`): a failure anywhere in the scope rolls back.
- Services and layers let the tests swap the database for an in-memory one without changing any handler.

**Consequences:** Effect has a learning curve, and a reviewer has to read generator-style code. The SPA never imports Effect: it consumes the committed OpenAPI document through orval-generated hooks.

## Decision: Persistence — SQLite through `node:sqlite`

**Context:** The service must not oversell or double-redeem under concurrent requests. Evaluators also need setup that is repeatable and uses no external services.

**Options considered:**

- An in-memory store guarded by locks.
- Postgres in Docker.
- An embedded SQLite file.

**Choice:** SQLite via `@effect/sql-sqlite-node`, which uses Node 24's built-in `node:sqlite` (no native build step). The database path comes from `DATABASE_PATH` (default `apps/api/data/store.db`, resolved against the API package rather than the working directory). Tests use `:memory:`.

**Why:**

- SQLite gives real transactions, `CHECK` and `UNIQUE` constraints, and conditional `UPDATE ... WHERE` statements. The invariants can therefore be enforced the way they would be in production, not with in-process locks that disappear with a second instance.
- The schema uses `STRICT` tables, so a non-integer can never land in a money or inventory column.

**Consequences:** The client runs one connection behind a semaphore with `BEGIN IMMEDIATE`, so transactions are serialized. The design does not rely on that serialization: every invariant has a conditional write and a schema constraint, which carry over to Postgres (covered in the concurrency section). The SQLite file is the one component that does not scale out.

## Decision: Schema evolution — numbered migrations and an idempotent seed on startup

**Context:** Evaluators need a working catalog immediately, and a way to get back to a known state between scenarios.

**Choice:**

- Migrations are numbered modules (`apps/api/src/shared/db/migrations/0001_*.ts`), registered explicitly and run on every startup by Effect's migrator.
- The seed then inserts six products, but only when the products table is empty. One product has stock 3 (the oversell demo). One costs 1999 cents, where a 10% discount is 199.9 cents and exercises rounding.
- `vp run db:reset` drops every table, then re-runs the migrations and the seed.

**Why:**

- The server and the tests build the database through the same layer (`Database.layer`), so tests always run against the real schema and seed.
- Migrations are registered explicitly rather than globbed, because the server runs under plain Node type stripping with no bundler.
- Reset drops whatever tables exist rather than listing them by hand, so later migrations need no reset changes.

## Decision: Repository shape — pnpm workspace with two apps and no shared contract package

**Context:** The API and the SPA must agree on a contract without the SPA depending on Effect.

**Options considered:** a shared `contract` package of Effect schemas imported by both apps, or the OpenAPI document as the contract.

**Choice:**

- `apps/api`, `apps/web`, and `packages/tsconfig` (shared compiler settings).
- The committed `apps/api/openapi.json` is the contract. `vp run openapi` regenerates it from the API definition, and a drift test fails when it is stale.
- The web app regenerates its orval hooks from that file before `dev` and `build`. The generated code is git-ignored.
- Code is grouped by feature (`features/products`, and later carts, checkout, orders, coupons, admin report), with cross-cutting code under `shared/` (config, errors, money, database).

**Why:** A shared Effect package would put Effect into the SPA bundle and couple both apps to one runtime library. The OpenAPI document is language-neutral, and it is the same artifact an external client would use.

**Consequences:** A contract change has three steps: change the schema, run `vp run openapi`, commit. CI enforces this through the drift test.

## Decision: Shared error body and request validation

**Context:** API clients need errors they can branch on reliably.

**Choice:**

- Every error body is `{ code, message, details }`. `code` is a stable literal, and its HTTP status is declared on the error schema, so both appear in the OpenAPI document.
- Request decoding failures (path, query, headers, body) are converted into `400 VALIDATION_ERROR` by one API-wide middleware (`RequestValidation`). Its `details` carry the location and a list of `{ path, message }` issues.
- Failures while encoding our own response remain 500s, because they are server bugs, not client errors.

**Why:** Without the middleware, Effect returns an empty 400 for invalid input, which tells a client nothing. Declaring the middleware on the API adds `VALIDATION_ERROR` to every endpoint's documented responses automatically.

## Decision: Administrative operations — under `/api/admin`, with no authentication

**Context:** Some operations belong to the store operator, not shoppers. The assignment has no users or login, but evaluators need to drive these operations (for example, changing a price between add-to-cart and checkout).

**Choice:**

- These operations are administrative:
  - updating a product's price and/or inventory (`PATCH /api/admin/products/{id}`);
  - generating coupons, listing coupons, listing orders, and the report, which later tickets add.
- Shopper operations stay public: the catalog, carts, checkout, and reading an order by id.
- Each administrative group ends with `.prefix("/admin").middleware(AdminAuth)`. `AdminAuth` (`apps/api/src/shared/admin.ts`) is the single seam for authentication. Today it passes every request through.
- A product update takes absolute values, not deltas. `unitPriceCents` and `availableInventory` are both optional (the same names `GET /api/products` returns), but at least one is required. Each must be a non-negative integer.

**Why:**

- Authentication would add credentials to every evaluator request and to the SPA, without exercising any of the invariants the assignment is about.
- Grouping the routes still makes them easy to protect later, by code or at a gateway by path. To add auth, give `AdminAuth` a security scheme and a 401 error, then check the credential in `AdminAuthLive`. No endpoint or handler changes, and the OpenAPI document picks up the scheme automatically.
- Absolute values make an update safe to retry: sending the same request twice leaves the same state. A delta ("add 5 units") would double-apply on retry.

**Consequences:** Anyone who can reach the API can change prices and stock. This is acceptable for a local demo and is not acceptable in production.

## Decision: Carts — anonymous bearer ids, set-quantity lines, live prices, no reservation

**Context:** The assignment leaves open what happens when a price or stock level changes between adding an item and checking out. Clients also retry requests, so adding an item must not double it.

**Choice:**

- **Anonymous bearer carts.** `POST /api/carts` returns a cart whose id is a UUIDv7 (`node:crypto` `randomUUIDv7`, behind the `Ids` reference so tests can supply their own). The id is the only credential: there are no accounts. Carts never expire.
- **Set-quantity semantics.** `PUT /api/carts/{id}/items/{productId}` with `{ quantity }` creates the line or replaces its quantity (an upsert on the `(cart_id, product_id)` primary key). There is no increment. `DELETE` removes the line, and removing a product that is not in the cart is a no-op that returns the cart. Every cart write returns the full cart view.
- **Validation on set.** The quantity must be an integer from 1 to 99 (schema → `400 VALIDATION_ERROR`, plus a `CHECK` on the column), the product must exist (`404 PRODUCT_NOT_FOUND`, plus a foreign key), and the quantity must not exceed current inventory (`409 INSUFFICIENT_INVENTORY`, the same error checkout uses, listing short lines with requested and available quantities). A malformed cart id is a `400`; a well-formed id with no cart is `404 CART_NOT_FOUND`.
- **Live prices.** Cart lines store no price. `GET /api/carts/{id}` joins each line to the product's current price and inventory, and returns `unitPriceCents`, `lineTotalCents`, `availableInventory` and an `insufficientStock` flag per line, plus `itemCount` (total units) and `subtotalCents`.
- **No reservation.** Adding to a cart holds no inventory. The stock check on set is a soft check against stock as it is at that moment; checkout re-checks authoritatively with a conditional decrement.

**Why:**

- A UUIDv7 carries 74 random bits, so a cart cannot be guessed or enumerated, while its time ordering keeps the primary-key index append-friendly. Accounts would add login to every evaluator request without exercising any invariant.
- An absolute quantity is idempotent: retrying the same `PUT` leaves the same state. An "add one" operation would double on a retried request. The SPA's "Add to cart" sends the current quantity plus one, which is still absolute on the wire.
- Live pricing means the cart always shows the price the shopper would actually pay. A price stored at add-to-cart would either be honoured (the store sells at a stale price) or silently replaced at checkout (the shopper pays an amount they never saw). Checkout's price guard (ticket 05) closes the remaining gap between viewing the cart and checking out.
- Reserving stock at add-to-cart lets abandoned carts block other shoppers indefinitely, and carts never expire. The `insufficientStock` flag tells the shopper which lines to fix when stock drops below their quantity.

**Consequences:** A shopper can see a line become short, or a total change, between visits. That is deliberate and visible in the cart view. Anyone holding a cart id can read and change that cart.

## Configuration

`n` and `x` are read from `COUPON_EVERY_N_ORDERS` (default 5, integer ≥ 1) and `COUPON_DISCOUNT_PERCENT` (default 10, integer 1–100). `DATABASE_PATH` and `PORT` are also read from the environment. Startup loads all of them through one validated `Config`, so an invalid value stops the process before it listens.

## Toolchain notes

- **Single Vitest instance.** `@effect/vitest` imports `vitest`. pnpm installs that as a different copy from the one `vp test` runs, which fails with "failed to find the current suite". The workspace overrides `vite` and `vitest` as the Vite+ docs recommend. That alone did not merge the copies (their peer sets still differed), so `apps/api/vite.config.ts` also inlines `@effect/vitest` and aliases `vitest` to `vite-plus/test`.
- **Tailwind v4 and shadcn under Vite+ (the open risk).** This worked without modification. `shadcn init -t vite` detected Vite and Tailwind v4 from a `vite.config.ts` that imports `defineConfig` from `vite-plus`. The only additions were the `@` path alias in `vite.config.ts` and `tsconfig.json`. Non-interactive init also needs a preset (`-p nova`). Because `vite` resolves to the Vite+ core (versioned 1.x), plugins report unmet `vite` peers, which `peerDependencyRules` allows.
- **orval fetch mutator.** orval's fetch client returns `{ data, status }` and does not throw on 4xx. A small mutator (`apps/web/src/api/fetcher.ts`) returns the body on success and throws an `ApiError` carrying `{ code, message, details }` otherwise, so TanStack Query surfaces API errors as errors.
