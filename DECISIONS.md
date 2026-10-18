# Decisions

How the checkout and rewards service stays correct, and why it is built the way it is. The README covers setup and the endpoint table; `SPEC.md` is the spec written before building.

**Contents**

1. [System invariants](#system-invariants) and where each is enforced
2. [Ambiguities and the semantics chosen](#ambiguities-and-the-semantics-chosen)
3. Decisions (the material ones as Context / Options considered / Choice / Why / Consequences; the smaller ones keep only the parts that apply): [stack](#decision-stack--effect-4-http-api-on-node-24-react-spa), [persistence](#decision-persistence--sqlite-through-nodesqlite), [schema evolution](#decision-schema-evolution--numbered-migrations-and-an-idempotent-seed-on-startup), [repository shape](#decision-repository-shape--pnpm-workspace-with-two-apps-and-no-shared-contract-package), [error body](#decision-shared-error-body-and-request-validation), [admin operations](#decision-administrative-operations--under-apiadmin-with-no-authentication), [carts](#decision-carts--anonymous-bearer-ids-set-quantity-lines-live-prices-no-reservation), [checkout](#decision-checkout--one-transaction-conditional-writes-constraints-behind-them), [replay and price guard](#decision-checkout-replay-and-the-price-guard--the-cart-is-the-idempotency-key), [coupon generation](#decision-coupon-generation--lazy-counted-from-orders-one-guarded-insert), [coupon redemption](#decision-coupon-redemption--one-guarded-update-inside-checkout), [report](#decision-report-and-order-list--computed-on-read-no-counters-no-pagination)
4. [Transaction, concurrency and idempotency strategy](#transaction-concurrency-and-idempotency-strategy)
5. [Money and rounding](#money-and-rounding)
6. [Error model](#error-model)
7. [Implemented versus deferred](#implemented-versus-deferred)
8. [Multiple instances and Postgres](#multiple-instances-and-postgres)
9. [AI usage](#ai-usage)
10. [What I would examine first with two more hours](#what-i-would-examine-first-with-two-more-hours)
11. [Configuration](#configuration) and [toolchain notes](#toolchain-notes)

## System invariants

Each invariant has two independent guards: a condition inside the write statement that makes the operation refuse, and a schema constraint that refuses the row if the statement were ever wrong. Neither relies on SQLite running one transaction at a time. Test numbers in this file ("test 2") refer to the list in SPEC.md, Testing Decisions.

| #   | Invariant                                                                              | Guard in the statement                                                                             | Constraint in the schema                                                                                          | Where                                                   | Test                                                     |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Inventory never goes below zero (no oversell)                                          | `UPDATE products … WHERE id = ? AND available_inventory >= ?`                                      | `CHECK (available_inventory >= 0)`                                                                                | `ProductRepository.decrementInventory`, checkout step 5 | oversell race                                            |
| 2   | A cart produces at most one order                                                      | `UPDATE carts SET status = 'CHECKED_OUT' WHERE id = ? AND status = 'OPEN'`                         | `UNIQUE (cart_id)` on `orders`                                                                                    | `CartRepository.claim`, checkout step 1                 | retry storm                                              |
| 3   | A checked-out cart's lines never change                                                | `INSERT … SELECT … FROM carts WHERE status = 'OPEN'`; `DELETE … AND EXISTS (… status = 'OPEN')`    | —                                                                                                                 | `CartRepository.setQuantity`, `removeLine`              | replay tests (`CART_NOT_OPEN`)                           |
| 4   | A coupon is redeemed at most once                                                      | `UPDATE coupons … WHERE code = ? AND redeemed_order_id IS NULL`                                    | `UNIQUE` index on `orders.coupon_code`; `UNIQUE (redeemed_order_id)` on `coupons`                                 | `CouponRepository.redeem`, checkout step 6              | coupon race                                              |
| 5   | A failed checkout consumes nothing (cart, stock, coupon)                               | every checkout write is in one `sql.withTransaction`; any failure rolls all of them back           | —                                                                                                                 | `CheckoutService`                                       | failed-on-stock tests, coupon survives a failed checkout |
| 6   | At most one coupon per milestone, and only once it is reached                          | one `INSERT … SELECT` computes the next milestone and checks `COUNT(orders)` in the same statement | `UNIQUE (milestone_order_count)`                                                                                  | `CouponRepository.issueNext`                            | generation race                                          |
| 7   | An order explains itself and never changes after checkout                              | lines and amounts copied into `orders` / `order_lines`; reads never join `products`                | `CHECK (line_total_cents = unit_price_cents * quantity)`, `CHECK (total_cents = subtotal_cents - discount_cents)` | `OrderRepository.insert`, `findById`                    | price change and snapshot                                |
| 8   | A total is never negative, and a discount never exceeds x%                             | `discountCents` floors and clamps to the subtotal                                                  | `CHECK (total_cents >= 0)`, `CHECK (discount_percent BETWEEN 1 AND 100)`                                          | `shared/money.ts`                                       | 1999 × 10% → 199                                         |
| 9   | Money is exact                                                                         | integer cents only, `Cents` schema rejects non-integers at the edge                                | `STRICT` tables with `INTEGER` columns                                                                            | `shared/money.ts`, migrations                           | every amount assertion                                   |
| 10  | The shopper is never charged a subtotal they did not see (when they say what they saw) | `expectedSubtotalCents` compared inside the checkout transaction, before any stock moves           | —                                                                                                                 | `CheckoutService`, step 4; `priceLines` for both sides  | price change                                             |
| 11  | The report reconciles with the orders and coupons, and reading it changes nothing      | one `SELECT` over orders, order lines and coupons; no stored counters                              | the order amount `CHECK`s make gross − discounts = net hold row by row                                            | `ReportRepository`                                      | report reconciliation                                    |

Two things are deliberately **not** invariants: a cart holding stock (carts reserve nothing; checkout decides), and a coupon being bound to a customer (there are no customers).

## Ambiguities and the semantics chosen

| Ambiguity in the brief                                               | Semantics chosen                                                                                                                                                                        | Where argued                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Price changes between add-to-cart and checkout                       | Carts store no price and always show current prices. Checkout charges current prices, and refuses with `PRICE_CHANGED` if they differ from the `expectedSubtotalCents` the client sent. | Carts; replay and price guard |
| Stock changes between add-to-cart and checkout                       | Nothing is reserved. Setting a quantity is soft-checked against current stock; the cart flags lines that became short; checkout decides authoritatively and lists every short line.     | Carts; checkout               |
| What "retry" means for checkout, and how a retry is recognised       | The cart is the idempotency key. Same cart and same coupon code → replay (`200`, same order). Different coupon → `409 CART_ALREADY_CHECKED_OUT`.                                        | Replay and price guard        |
| "Add an item" and "change its quantity" under retries                | One set-quantity `PUT` (replace, never add) and an idempotent `DELETE`. There is no increment.                                                                                          | Carts                         |
| Valid quantities                                                     | Integers from 1 to 99 per line. Zero is not "remove"; that is `DELETE`.                                                                                                                 | Carts                         |
| Is a discounted order counted towards the next milestone?            | Yes: every successfully placed order counts.                                                                                                                                            | Coupon generation             |
| Eager or on-request coupon generation; what about skipped milestones | On request by an admin. Each request issues one coupon for the oldest unrewarded milestone, so backlog drains oldest first, one per request.                                            | Coupon generation             |
| Who may redeem a coupon, and for how long                            | Bearer codes: anyone holding the code, once, no expiry.                                                                                                                                 | Coupon generation             |
| Stacking, scope and rounding of discounts                            | One coupon per order, applied to the whole subtotal, floor(subtotal × x / 100), clamped so the total is never negative.                                                                 | Money and rounding            |
| What a coupon is worth if x changes later                            | The percent is copied onto the coupon at generation; issued coupons never change. Changing n reinterprets future milestones (documented, not engineered).                               | Coupon generation             |
| Which error wins when several apply                                  | Checkout order decides: empty cart, then price guard, then stock, then coupon. A request short on stock with a taken coupon gets `INSUFFICIENT_INVENTORY`.                              | Coupon redemption             |
| Payment                                                              | None: a committed checkout is a successful payment. The pending → charge → confirm/compensate design with an outbox is described, not built.                                            | Checkout                      |
| "Gross revenue before discounts"                                     | Sum of order subtotals at the prices charged (from snapshots), not current catalog prices.                                                                                              | Report                        |
| Which operations are administrative                                  | Product updates, coupon generation and listing, the order list and the report, all under `/api/admin`. Reading one order by id is a shopper operation.                                  | Administrative operations     |
| Currency                                                             | One implicit currency (USD), integer cents.                                                                                                                                             | Money and rounding            |

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

## Decision: Checkout — one transaction, conditional writes, constraints behind them

**Context:** Many shoppers check out at once against limited stock. The store must never oversell, a cart must produce at most one order, and a checkout that fails part-way must leave nothing behind.

**Options considered:**

- Read stock in the handler, check it, then write it (check-then-act).
- Rely on SQLite's single writer to serialize checkouts.
- A pessimistic lock (`SELECT ... FOR UPDATE`) on every product, then plain writes.
- One transaction in which every write is a conditional update whose guard is in the statement itself, each backed by a schema constraint.

**Choice:** The last. `POST /api/carts/{id}/checkout` (`apps/api/src/features/checkout/CheckoutService.ts`) runs inside `sql.withTransaction`, in this order. The step numbers follow SPEC.md and the comments in the code.

1. **Claim the cart:** `UPDATE carts SET status = 'CHECKED_OUT' WHERE id = ? AND status = 'OPEN'`. No row changed means the cart is missing (`404 CART_NOT_FOUND`) or already checked out, which is a replay (`200` with the existing order) or a conflict (`409 CART_ALREADY_CHECKED_OUT` with the existing `orderId`); see the next decision.
2. **Load the lines** in product-id order. None → `422 EMPTY_CART`.
3. **Price them** at current prices: line total = unit price × quantity, subtotal = sum of line totals, all integer cents.
4. **Price guard:** an `expectedSubtotalCents` that differs from the subtotal → `409 PRICE_CHANGED`; see the next decision.
5. **Take the stock**, line by line in product-id order: `UPDATE products SET available_inventory = available_inventory - q WHERE id = ? AND available_inventory >= q`. A line that changes no row is short; its current inventory is re-read for the error. Every line is attempted, so `409 INSUFFICIENT_INVENTORY` lists every short line with requested and available quantities.
6. **Redeem the coupon**, if a `couponCode` was given: `UPDATE coupons SET redeemed_order_id = ?, redeemed_at = ? WHERE code = ? AND redeemed_order_id IS NULL RETURNING ...`. No row changed means the code is unknown (`422 COUPON_INVALID`) or already redeemed (`409 COUPON_ALREADY_REDEEMED`); see the coupon redemption decision.
7. **Insert the order and its line snapshots** (product name, unit price, quantity, line total copied from step 3; the coupon code, its percent and the discount from step 6). Orders are read back from the snapshots only, never joined to products, so later catalog changes do not alter them.
8. **Commit.** Any failure in an earlier step (a typed error or a defect) rolls the whole transaction back: the cart is `OPEN` again, no inventory moved and the coupon is still available.

After a successful checkout, `GET /api/carts/{id}` shows `orderId`, and `GET /api/orders/{id}` returns the order.

| Invariant                     | Guard in the statement                      | Constraint in the schema                                                                                          |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No oversell                   | `available_inventory >= q` on the decrement | `CHECK (available_inventory >= 0)`                                                                                |
| One order per cart            | `status = 'OPEN'` on the claim              | `UNIQUE (cart_id)` on `orders`                                                                                    |
| Snapshots are self-consistent | —                                           | `CHECK (line_total_cents = unit_price_cents * quantity)`, `CHECK (total_cents = subtotal_cents - discount_cents)` |

**Why:**

- **The guard and the write are one statement,** so there is no gap between "is there enough?" and "take it" for another checkout to slip into. The constraint is the backstop: if a future change dropped the guard, the database would refuse the write instead of storing an oversold row.
- **SQLite serialization is not relied upon.** `@effect/sql-sqlite-node` runs one connection behind a semaphore and starts transactions with `BEGIN IMMEDIATE`, so checkouts already run one at a time. That is a second line of defence, and the design holds without it.
- **Portable to Postgres under READ COMMITTED.** There, a conditional `UPDATE` locks the row it changes. A concurrent `UPDATE` of the same row waits for that lock, then re-evaluates its `WHERE` against the newly committed row before writing. Two checkouts for the last unit therefore cannot both pass `available_inventory >= 1`, and two claims of the same cart cannot both see `status = 'OPEN'`. No `SERIALIZABLE` isolation, retry loop or `FOR UPDATE` is needed. The plain reads in steps 2–3 can be momentarily stale under READ COMMITTED, but correctness never depends on them: stock is decided by the guarded decrement, and the price read is the price snapshotted (the price guard rejects a subtotal the shopper did not see).
- **Lock ordering.** Decrementing in product-id order means two checkouts that share products always lock those rows in the same order, so on Postgres they queue instead of deadlocking. It makes no difference on SQLite's single writer.
- **Rollback rather than compensation.** Continuing past a short line and then failing is safe because nothing is visible until commit; undoing the earlier decrements is the transaction's job, not the code's.

**Why the race tests are meaningful on a single connection:** the tests (`apps/api/src/features/checkout/checkout.test.ts`) fire genuinely concurrent requests as parallel fibers. The SQLite client serializes the transactions, so they cannot catch a database-level race. What they do catch is the realistic bug: a check-then-act that spans transactions, such as reading stock in the handler (or in its own transaction) and decrementing it in a later one. Fibers interleave at every effect boundary between transactions, so two checkouts can both read "3 left" before either writes, and such an implementation fails the oversell test. They cannot catch a read-then-write _inside_ one transaction, because the client holds the connection for the whole transaction: that case is covered by the guard being in the statement, and by the Postgres argument above, not by the tests. A mutation check confirmed the rollback test fails without the transaction.

**Payment:** there is no payment integration. A committed checkout is treated as a successful payment, which keeps the transaction purely local. A real integration cannot charge a card inside a database transaction (the charge cannot be rolled back, and holding locks across a network call blocks other shoppers). The deferred design: commit the order as `PENDING` with stock taken, write a "charge" message to an outbox table in the same transaction, have a worker call the payment provider with the order id as its idempotency key, then mark the order `PAID` or compensate (cancel it and return the stock).

**Consequences:** Stock is decided at checkout, not at add-to-cart, so a shopper can lose a race they could not see coming; the error says exactly which lines to fix. Each product row is a contention point under heavy demand for one item, which is acceptable at this scale.

## Decision: Checkout replay and the price guard — the cart is the idempotency key

**Context:** Clients retry checkout after a timeout without knowing whether the first attempt committed. A retry must return the original order, never place a second one or take stock twice. Separately, a price can change between the shopper viewing the cart and checking out, and the shopper must never be charged a subtotal they did not see.

**Options considered:**

- A client-supplied `Idempotency-Key` header, with stored request fingerprints and responses.
- The cart itself as the key: a cart produces at most one order, so "checkout of cart X" can only ever mean one order.

**Choice:** The cart. `POST /api/carts/{id}/checkout` takes an optional body `{ couponCode?, expectedSubtotalCents? }` (an empty body is the same as `{}`).

- **Replay vs conflict.** When the claim changes no row because the cart is `CHECKED_OUT`, the request is compared with the one that placed the order. Same coupon code as the order records (or both absent) → **replay**: `200` with the existing order, read back from its snapshots. A different coupon code → `409 CART_ALREADY_CHECKED_OUT` with `orderId` in `details`. The first checkout answers `201`, so a client can tell "placed now" from "already placed". `expectedSubtotalCents` is ignored on replay: prices may have moved since, and the order already records what was charged.
- **Only the coupon code is compared.** It is the only input that changes what the order is. The cart's lines cannot differ, because a checked-out cart cannot change: `PUT` and `DELETE` on its items return `409 CART_NOT_OPEN`. That guard is in the write itself (`INSERT ... SELECT ... FROM carts WHERE id = ? AND status = 'OPEN'`, and `DELETE ... AND EXISTS (... status = 'OPEN')`), not a status read beforehand, so a checkout cannot land between a check and the write.
- **Price guard.** After pricing the lines, if `expectedSubtotalCents` is present and differs from the computed subtotal, checkout fails with `409 PRICE_CHANGED`, carrying the expected subtotal, the new subtotal and the newly priced lines. The transaction rolls back, so the cart stays `OPEN` and no stock moves. The SPA always sends the subtotal on screen; on `PRICE_CHANGED` it shows the new totals and, on confirmation, checks out again with the new value. The field is optional so a plain API client can still check out, accepting current prices.

**Why:**

- **The cart is a natural idempotency key.** The conditional claim plus `UNIQUE (cart_id)` on `orders` already guarantee one order per cart under any number of concurrent retries (test 2: ten concurrent checkouts of one cart produce one `201`, nine `200`s with the same order id, and one stock decrement). A header would add a second key, storage for fingerprints and responses, and an expiry policy, all to protect an invariant the schema already enforces.
- **A different request is a conflict, not a replay.** Returning the old order to a request with a different coupon would tell the client its coupon was applied when it was not.
- **When a header would become necessary:** as soon as one checkout request can create something that has no natural key. Examples are reorders (several orders from one cart), checkout without a server-side cart (lines in the request body), or a side effect outside the database, such as a payment charge, that must be deduplicated across a retry. Then the client's key, stored with a fingerprint of the request under a unique constraint, is the only thing that identifies "the same attempt".
- **Why the subtotal, not the total, is guarded:** the client never computes discounts. The discount is a deterministic function of the subtotal and the coupon (SPEC.md, Money), so a matching subtotal means the total is the one the shopper would expect for that coupon. Guarding the total would make the client reimplement the rounding rule and drift whenever it changed.

**Consequences:** A retry that changes the coupon cannot "fix" an order: the shopper needs a new cart. The OpenAPI document marks the checkout body as required, because Effect's generator does, but the server accepts an empty body; the `CheckoutRequest` description says so.

## Decision: Coupon generation — lazy, counted from orders, one guarded insert

**Context:** Every n-th successful order makes one coupon for x% off available. Administrators generate it, and double-clicks, retries and concurrent requests must never issue two coupons for one milestone.

**Options considered:**

- Eager: checkout inserts the coupon in the same transaction as the n-th order.
- Milestones from order sequence ids (the n-th id, 2n-th id, ...).
- Lazy: `POST /api/admin/coupons/generate` issues the coupon on request, with milestones derived from `COUNT(orders)` and `COUNT(coupons)`.

**Choice:** Lazy generation (`apps/api/src/features/coupons/`).

- **The next milestone is (coupons generated + 1) × n.** It is eligible once `COUNT(orders)` has reached it. Every successful order counts, including discounted ones. Each request issues at most one coupon, so skipped milestones are issued oldest first, one per request: with 10 orders and n = 5, two requests issue milestones 5 and 10, and a third is refused.
- **One statement decides and writes:**
  ```sql
  INSERT INTO coupons (code, milestone_order_count, discount_percent, created_at)
  SELECT ?, next.milestone, ?, ?
  FROM (SELECT (COUNT(*) + 1) * n AS milestone FROM coupons) AS next
  WHERE (SELECT COUNT(*) FROM orders) >= next.milestone
  ON CONFLICT (milestone_order_count) DO NOTHING
  RETURNING ...
  ```
  No row back means no milestone is eligible, and the request gets `409 NO_ELIGIBLE_MILESTONE` with `orderCount` and `nextMilestoneOrderCount` in `details`. Those are read after the refusal, so a request that lost a race reports the milestone after the one the winner took.
- **A coupon stores** its code, its milestone order count (`UNIQUE`), the discount percent copied from config at generation, and a created timestamp. The code is `SAVE<x>-` plus 8 Crockford base32 characters (40 bits from `crypto.getRandomValues`, behind the `Ids` reference) and is the primary key. The redemption columns (`redeemed_order_id UNIQUE`, `redeemed_at`) are null until checkout redeems the coupon.
- **`GET /api/admin/coupons`** lists every coupon, newest milestone first, with `status` `AVAILABLE` or `REDEEMED` derived from `redeemed_order_id`.

| Invariant                | Guard in the statement                                | Constraint in the schema         |
| ------------------------ | ----------------------------------------------------- | -------------------------------- |
| One coupon per milestone | the milestone is computed and checked in the `INSERT` | `UNIQUE (milestone_order_count)` |
| Unique codes             | —                                                     | `code` is the primary key        |

**Why:**

- **Lazy, not eager.** Generation stays out of checkout, the hottest and most delicate transaction, and a generation bug cannot fail an order. It is also what the assignment's admin API asks for. The cost is that a milestone is only rewarded when someone asks, which is acceptable for an admin-driven reward.
- **`COUNT(orders)`, not sequence ids.** A sequence can skip values (on Postgres a rolled-back insert still consumes its id, and every failed checkout rolls back), so "the order with id 5n" might never exist. A count of committed orders has no gaps.
- **Percent snapshot per coupon.** A coupon is a promise made when it was issued. Copying x onto the row means changing `COUPON_DISCOUNT_PERCENT` later never changes what an issued coupon is worth; the code's `SAVE<x>-` prefix matches the snapshot.
- **Bearer coupons without expiry.** There are no accounts to bind a coupon to, and the spec gives no expiry. Whoever holds the code can redeem it once. Adding expiry later is a nullable `expires_at` column and one more condition on the redemption update.
- **Portable to Postgres under READ COMMITTED.** Two concurrent statements there can both see the same coupon count and pick the same milestone. The second blocks on the unique index entry the first inserted, then sees the conflict once the first commits; `DO NOTHING` turns that into "no row", so the loser is refused rather than erroring. No serializable isolation or retry loop is needed.

**What the race test does and does not prove:** test 5 (`coupons.test.ts`) fires five concurrent generate requests at exactly one eligible milestone and asserts one `201` and four `NO_ELIGIBLE_MILESTONE`, then that a sixth request before the next milestone is refused. A mutation check showed its limit: splitting the count read from the insert into two statements _and_ dropping the unique constraint still passed, because on the in-memory SQLite client the requests did not interleave between the two statements. So the test pins the observable behaviour, but the guarantee against over-issuing rests on the single statement and the unique constraint, argued above, not on the test.

**Changing n:** future milestones are reinterpreted as (coupons generated + 1) × new n; issued coupons are unaffected. This is documented, not engineered. Two consequences follow. Raising n postpones the next coupon (with 2 coupons and n changed from 5 to 10, the next milestone is 30, not 15). Lowering n can make the next milestone equal one already issued (with 4 coupons at 5–20 and n changed to 2, the next milestone is 10). The unique constraint then refuses it permanently, and generation answers `NO_ELIGIBLE_MILESTONE` forever. Recovering would need milestones computed from the highest issued milestone instead of the count, which is the change to make if n ever becomes runtime-configurable.

**Consequences:** Generation is safe to call any number of times, concurrently. A 40-bit code collision is not retried: it fails the request with a 500 (primary-key violation) and the next request succeeds. With at most one coupon per n orders, the chance is negligible.

## Decision: Coupon redemption — one guarded update inside checkout

**Context:** A shopper supplies a coupon code at checkout. A coupon must be redeemed at most once, even when two checkouts race for it, and must never be consumed by a checkout that fails. The discount must be deterministic and must never make a total negative.

**Options considered:**

- Read the coupon, check it is unredeemed, place the order, then mark the coupon redeemed (check-then-act).
- Redeem in its own transaction before checkout, and release the coupon if checkout fails (compensation).
- Redeem with a conditional update inside the checkout transaction, so it commits or rolls back with the order.

**Choice:** The last, as step 6 of checkout (`apps/api/src/features/checkout/CheckoutService.ts`, `CouponRepository.redeem`):

```sql
UPDATE coupons SET redeemed_order_id = ?, redeemed_at = ?
WHERE code = ? AND redeemed_order_id IS NULL
RETURNING ...
```

- **No row back** means the code is unknown or already taken. A follow-up read by code tells them apart: no coupon → `422 COUPON_INVALID`, a redeemed coupon → `409 COUPON_ALREADY_REDEEMED`. That read happens after the guarded write has already failed, so it only chooses the error message; it never decides whether the coupon is taken.
- **Rollback, not compensation.** Every later failure, and every typed error in the transaction, rolls the redemption back with the claim and the stock, so a coupon cannot be lost to a checkout that fails (test 4). The losing side of a race gets its whole transaction rolled back: its cart stays `OPEN` and its stock is untouched (test 3).
- **The order records** `couponCode`, `discountPercent` (copied from the coupon's snapshot, returned by the update) and `discountCents`. The coupon records `redeemedOrderId` and `redeemedAt`, which `GET /api/admin/coupons` shows. Replay compares the request's code with the order's `couponCode` (see the replay decision).

**Ordering within the transaction:**

- **After the stock (step 5).** Correctness does not depend on the order, because every step rolls back together. Redeeming last of the guarded writes means a request that would fail on stock anyway never touches the coupon row, and on Postgres the coupon's row lock is held for the shortest possible time. A request with both a short line and a taken coupon is reported as `INSUFFICIENT_INVENTORY`.
- **Before the order insert (step 7).** The discount needs the coupon's percent, and taking it from the guarded update's `RETURNING` means the percent the order uses is the one on the row it redeemed. The coupon therefore references an order that does not exist yet. Migration `0005_add_coupon_redemption` rebuilds `coupons` with `redeemed_order_id ... REFERENCES orders (id) DEFERRABLE INITIALLY DEFERRED`, so that reference is checked at commit, after the order is inserted. SQLite cannot alter a constraint in place, so the table is rebuilt; Postgres supports the same deferred constraint.

| Invariant                    | Guard in the statement                    | Constraint in the schema                                                                        |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One redemption per coupon    | `redeemed_order_id IS NULL` on the redeem | `UNIQUE (coupon_code)` on `orders`                                                              |
| One coupon per order         | `couponCode` is a single field            | `UNIQUE (redeemed_order_id)` on `coupons`                                                       |
| An order has a coupon or not | —                                         | `CHECK ((coupon_code IS NULL) = (discount_percent IS NULL))`; `coupon_code` references a coupon |

**Money:** discount = floor(subtotal × percent / 100), clamped to the subtotal, on the whole subtotal; see [Money and rounding](#money-and-rounding).

**One coupon per order.** `couponCode` is a single optional string. Stacking would raise questions the brief does not answer (applied to the subtotal or to each other's result, in what order) and makes the discount depend on that order. One code per order keeps the discount a function of the subtotal and one percent.

**Portable to Postgres under READ COMMITTED.** Two checkouts with the same code both run the `UPDATE`; the second blocks on the row lock of the first, then re-evaluates `redeemed_order_id IS NULL` against the committed row. If the first committed, the second changes no row and is refused; if the first rolled back (say, on stock), the second redeems it. That last case is the "never lost to a failed checkout" rule holding under contention.

**What the race test proves:** test 3 (`checkout.test.ts`) fires two checkouts with the same code concurrently and asserts one `201` with the discount and one `COUPON_ALREADY_REDEEMED`, with the loser's cart `OPEN` and stock unchanged. A mutation check (dropping `AND redeemed_order_id IS NULL`) made it fail: the second update then overwrites the first redemption and the unique index on `orders.coupon_code` rejects the insert, which surfaces as a 500 instead of a clean 409.

**Consequences:** A shopper whose coupon is taken by someone else gets a clear 409 and can check out the same cart without it. The cart view does not preview discounts (SPEC.md); the order shows the discount line once placed.

## Decision: Report and order list — computed on read, no counters, no pagination

**Context:** An administrator needs the quantity sold per product, gross revenue, discounts, net revenue, coupon counts and the order count, and the figures must reconcile exactly with what `GET /api/admin/orders` and `GET /api/admin/coupons` return. Viewing the report must never change state.

**Options considered:**

- Stored counters (revenue totals, per-product quantities) updated inside the checkout transaction and by generation.
- A periodically refreshed summary table or materialized view.
- Aggregating on every request from orders, order line snapshots and coupons.

**Choice:** Aggregate on read (`apps/api/src/features/report/`). `GET /api/admin/report` is one `SELECT`. It sums `subtotal_cents`, `discount_cents` and `total_cents` over `orders`, counts coupons by `redeemed_order_id`, groups `order_lines` by product, and joins the one totals row to every product row. A single statement reads a single snapshot, on SQLite and on Postgres under `READ COMMITTED` alike, so a checkout committing mid-report cannot be counted in the totals but not the products. It needs no transaction, so it takes no write lock and writes nothing.

- `grossRevenueCents` = Σ subtotal, `totalDiscountsCents` = Σ discount, `netRevenueCents` = Σ total. The orders table's `CHECK (total_cents = subtotal_cents - discount_cents)` makes gross − discounts = net hold row by row, so it also holds for the sums.
- Per-product quantities come from the line snapshots, never from the live catalog, so a later price change or restock cannot change them. Each product is labelled with the name on its most recent snapshot, so the report reads without the catalog.
- `GET /api/admin/orders` lists every order with its lines, newest first (`created_at DESC`, then insertion order for orders placed in the same millisecond, since UUIDv7 is not monotonic within a millisecond).

**Why:**

- **No counters, no drift.** A counter is a second copy of facts the orders and coupons already hold. Every write path (checkout, its rollbacks, generation, redemption) would have to keep it in step, and one missed path makes the report disagree with the lists. Computed on read, the report reconciles by construction (test 6).
- **No extra contention on checkout.** Counters would be one hot row that every checkout updates, so concurrent checkouts would serialize on it. That would be a new bottleneck exactly where the race guarantees matter.
- **Read-only by construction.** The endpoint is a `GET` and issues only `SELECT`s. Test 6 asserts that two consecutive reports are identical and that the order and coupon lists are unchanged.

- **One statement, not a transaction.** Two `SELECT`s in a transaction would also be consistent on SQLite, but there the transaction is `BEGIN IMMEDIATE`, which takes the write lock for a pure read. On Postgres it would need `REPEATABLE READ` to share one snapshot. The single statement needs neither.

**Consequences:** The report costs a scan of `orders`, `order_lines` and `coupons` per request, which is negligible at assignment scale. At scale, the next step is a summary maintained by the same transaction or rebuilt from the orders, not ad hoc counters. In the SPA, every successful mutation marks the report, order and coupon queries stale (`apps/web/src/api/queryClient.ts`), so the admin views follow checkouts and coupon generation without each mutation knowing their keys.

**Deferred: pagination.** Order and coupon lists return everything (SPEC.md, out of scope). When it is needed, keyset pagination on `(created_at, id)` fits the newest-first order and stays stable while orders are inserted; offset pagination would skip or repeat rows under concurrent checkouts. The report needs no pagination because it is already aggregated.

## Transaction, concurrency and idempotency strategy

The decisions above argue each piece; this is the strategy in one place.

**One rule for every invariant:** the check and the write are the same statement, and a schema constraint stands behind it. "Is there enough stock?", "is the cart still open?", "is the coupon still unredeemed?" and "is this milestone reached and unrewarded?" are each a `WHERE` clause on the `UPDATE` or `INSERT` that acts on the answer. A statement that changes no row is the refusal. Nothing reads state in one step and writes based on it in a later one.

**One transaction per checkout.** Claim the cart, load and price the lines, apply the price guard, take the stock in product-id order, redeem the coupon, insert the order and its snapshots, commit. Any typed error or defect rolls everything back, so there is no compensation code: a failed checkout leaves the cart `OPEN`, the stock untouched and the coupon available. Every other write (cart edits, product updates, coupon generation) is a single statement, which is its own transaction.

**SQLite's serialization is a backstop, not the mechanism.** The SQLite client runs one connection and starts transactions with `BEGIN IMMEDIATE`, so transactions already run one at a time. The design is argued as if they did not: each guard is checked against Postgres under `READ COMMITTED`, where a conditional `UPDATE` waits for a competing row lock and then re-evaluates its `WHERE` against the committed row (see [Multiple instances and Postgres](#multiple-instances-and-postgres)).

**What the race tests prove.** They fire genuinely concurrent HTTP requests as parallel fibers. They catch check-then-act across separate statements or transactions, the realistic bug, because fibers interleave between them. They cannot catch a read-then-write inside one transaction on this single-connection client; that case rests on the guard being in the statement. Mutation checks on the rollback, coupon-race and generation tests confirmed which of them fail when their guard is removed. The generation test does not, which is recorded in that decision rather than overstated.

**Idempotency, endpoint by endpoint.** Every operation a client might retry has a defined outcome on the second attempt, without an idempotency-key store:

| Operation                           | On retry                                                                                                | Why                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PUT` cart item                     | Same state, same response                                                                               | Absolute quantity, not an increment                                |
| `DELETE` cart item                  | Same state; removing an absent line is a no-op                                                          | Deleting is naturally idempotent                                   |
| `POST` checkout                     | `200` with the original order (same coupon) or `409 CART_ALREADY_CHECKED_OUT` (different coupon)        | The cart is the key: conditional claim plus `UNIQUE (cart_id)`     |
| `PATCH` admin product               | Same state                                                                                              | Absolute values, not deltas                                        |
| `POST` coupon generation            | Issues the next eligible milestone, or `409 NO_ELIGIBLE_MILESTONE`; never two coupons for one milestone | Milestone computed in the insert, `UNIQUE (milestone_order_count)` |
| `POST` cart                         | A second empty cart                                                                                     | Harmless: an empty cart holds nothing and costs one row            |
| `GET` anything, the report included | No state change                                                                                         | Reads issue only `SELECT`s                                         |

The checkout response distinguishes "placed now" (`201`) from "already placed" (`200`), so a client that lost the first response can tell what happened. The SPA never retries checkout automatically; its **Retry checkout** button makes the replay visible.

## Money and rounding

- **Integer cents everywhere.** Every amount is an integer number of cents in one implicit currency (USD), stored in `INTEGER` columns of `STRICT` tables and exposed as integer fields suffixed `Cents`. The `Cents` schema (`apps/api/src/shared/money.ts`) rejects fractional and negative values at the API edge with `400 VALIDATION_ERROR`. No floating-point value appears on a money path.
- **Line total** = unit price × quantity. **Subtotal** = sum of line totals. **Discount** = floor(subtotal × percent / 100), clamped to the subtotal. **Total** = subtotal − discount.
- **One pricing function.** `priceLines` (`shared/money.ts`) computes the line totals and the subtotal for both the cart view and checkout, so the subtotal a shopper saw and the one the price guard compares cannot be computed differently. The clamp and the 1999 × 10% case are also tested directly in `shared/money.test.ts`.
- **Rounding down** never over-discounts: the store gives at most x%, never a fraction of a cent more. 10% of 1999 is 199, so the total is 1800 (test 7 and the walkthrough). `discountCents` computes the floor without floating point: it subtracts the remainder of subtotal × percent modulo 100 before dividing, so the division is exact.
- **The clamp** cannot trigger while percent is at most 100 (checked on the coupon row), but it keeps "never negative" true by construction, and `CHECK (total_cents >= 0)` backs it.
- **The discount applies to the whole subtotal,** not line by line: with no per-product coupons, per-line floors would only add drift (floors of lines summing to less than the floor of the total).
- **Deterministic:** the discount depends only on the subtotal and the coupon's snapshotted percent. The order stores `subtotalCents`, `discountPercent`, `discountCents` and `totalCents`, so anyone can recompute it, and the schema checks `total = subtotal − discount` on every row.
- **Range:** amounts are JavaScript numbers, exact up to 2⁵³. Subtotal × percent stays exact for subtotals up to about 9 × 10¹³ cents. Nothing enforces an upper bound on prices today; see [the last section](#what-i-would-examine-first-with-two-more-hours).

## Error model

Every error body has the same shape:

```json
{
  "code": "INSUFFICIENT_INVENTORY",
  "message": "Not enough inventory for 1 product",
  "details": { "lines": [{ "productId": 6, "requestedQuantity": 2, "availableInventory": 1 }] }
}
```

- **`code`** is a stable literal a client can branch on. **`message`** is for humans and may change. **`details`** is structured and typed per code, so a client can act without parsing the message: the short lines and what is left, the new subtotal and repriced lines, the existing order id.
- Each error class pins its code and HTTP status in its schema, and each endpoint declares which errors it can return. Both appear in the OpenAPI document, and handlers cannot return an undeclared error: it would not type-check.

| Status | Meaning                                                                                                                                            | Codes                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | The request does not match the endpoint's schema. Fix the request.                                                                                 | `VALIDATION_ERROR` (`details.location` is `path`, `query`, `headers` or `body`, plus `{ path, message }` issues)                           |
| `404`  | The resource named in the URL does not exist.                                                                                                      | `CART_NOT_FOUND`, `ORDER_NOT_FOUND`, `PRODUCT_NOT_FOUND`                                                                                   |
| `409`  | The request is valid, but conflicts with the current state. It might succeed once that state changes (fewer units, the new price, another coupon). | `INSUFFICIENT_INVENTORY`, `PRICE_CHANGED`, `CART_NOT_OPEN`, `CART_ALREADY_CHECKED_OUT`, `COUPON_ALREADY_REDEEMED`, `NO_ELIGIBLE_MILESTONE` |
| `422`  | The request is well formed but cannot be processed as it stands; repeating it will not help.                                                       | `EMPTY_CART`, `COUPON_INVALID`                                                                                                             |
| `500`  | A bug. Logged; the body is not part of the contract.                                                                                               | —                                                                                                                                          |

Choices behind the table:

- **Schema failures get a body.** Effect's default for a request that fails decoding is an empty `400`. One API-wide middleware turns it into `VALIDATION_ERROR` with the location and issues, and is declared on the API, so every endpoint documents it.
- **`COUPON_INVALID` is `422`, not `404`.** The URL names the cart, which exists. The coupon is a body field, and an unknown code makes the request unprocessable, not the resource missing. An already-redeemed coupon is different: the code is real but its state conflicts, so `409 COUPON_ALREADY_REDEEMED`.
- **`PRODUCT_NOT_FOUND` on `PUT /carts/{id}/items/{productId}` is a `404`,** because the product is in the URL.
- **`INSUFFICIENT_INVENTORY` lists every short line,** not the first, so a client fixes the cart in one pass. The same error is used by the soft check on `PUT` and by checkout.
- **Replay is a success, not an error.** A retried checkout returns `200` with the order; only a retry that asks for something different (another coupon) is `409 CART_ALREADY_CHECKED_OUT`, with the `orderId` so the client can still find what was placed.
- **Failures inside our own response encoding stay `500`.** They are server bugs and must not be reported as a client's validation error.
- **Precedence** follows the checkout steps: cart missing or checked out, then empty, then price guard, then stock, then coupon. The conflicts (checked out, stock, coupon) are detected by the guarded write itself, and follow-up reads only choose between messages (for example unknown versus already-redeemed coupon). An empty cart is found when the lines are loaded, and the price guard is a comparison inside the transaction before any stock moves.

## Implemented versus deferred

**Implemented:** every business requirement in the brief; every endpoint in the endpoint table; the invariants above, each with a guarded statement and a constraint; the replay and price-guard contract; lazy, race-safe coupon generation; redemption inside checkout; a report computed on read; the committed OpenAPI document with a drift test and served Scalar docs; executable request examples that CI runs; a test suite through the HTTP API, with race and retry tests; a small SPA, including the "Race it" demo and a manual checkout retry.

**Deferred on purpose:**

| Deferred                                                      | Why                                                                                   | How it would be added                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication and authorization                              | Exercises none of the invariants; adds credentials to every request                   | Give the `AdminAuth` middleware a security scheme and a `401`, check the credential in `AdminAuthLive`. Bind carts to accounts if shoppers get accounts.                                                     |
| Real payment                                                  | A charge cannot be rolled back with a database transaction                            | Commit the order `PENDING` with stock taken and an outbox row in the same transaction; a worker charges with the order id as the provider's idempotency key, then marks `PAID` or cancels and returns stock. |
| Postgres and multiple instances                               | SQLite keeps setup to `pnpm install`                                                  | See the next section; the statements and constraints carry over.                                                                                                                                             |
| Pagination of orders and coupons                              | Not needed at this scale                                                              | Keyset pagination on `(created_at, id)`, stable under concurrent inserts.                                                                                                                                    |
| Cart expiry and cleanup                                       | Carts hold no stock, so an abandoned cart costs only rows                             | `updated_at` plus a periodic delete of old `OPEN` carts.                                                                                                                                                     |
| Coupon expiry, per-customer coupons                           | No accounts; the brief gives no expiry                                                | A nullable `expires_at` (or `customer_id`) and one more condition on the redemption `UPDATE`.                                                                                                                |
| Stock reservation at add-to-cart                              | Abandoned carts would block other shoppers indefinitely                               | Time-limited holds in a reservations table, released by expiry or checkout.                                                                                                                                  |
| Runtime-configurable n                                        | Changing n today reinterprets future milestones and can stall generation (documented) | Compute the next milestone from the highest issued milestone instead of the coupon count.                                                                                                                    |
| Rate limiting, observability beyond logs, multiple currencies | Outside the correctness questions the assignment asks                                 | A gateway for rate limits; Effect's OpenTelemetry integration for traces; a currency column with per-currency minor units.                                                                                   |
| Frontend tests and runtime response validation in the SPA     | The SPA is a demo; the backend suite carries the guarantees                           | Playwright for the checkout and price-change flows; validate responses with schemas generated from the OpenAPI document.                                                                                     |

## Multiple instances and Postgres

The API process holds no state between requests: no caches, no in-memory locks, no counters. Every guarantee lives in the database, so more application instances behind a load balancer need no coordination with each other. The SQLite file is the one component that does not scale out, and moving to Postgres is the change.

**What carries over unchanged.** Every guarded statement and every constraint is plain SQL that Postgres supports, including the deferred foreign key on `coupons.redeemed_order_id`. Under the default `READ COMMITTED` isolation:

- **Stock:** two checkouts decrementing the last unit both run `UPDATE … WHERE available_inventory >= q`. The second blocks on the first's row lock, then re-evaluates the condition against the committed row and changes nothing. No oversell, no `SERIALIZABLE`, no retry loop, no `SELECT … FOR UPDATE`.
- **Cart claim:** the same mechanism on `status = 'OPEN'`; `UNIQUE (cart_id)` behind it.
- **Coupon redemption:** the same mechanism on `redeemed_order_id IS NULL`. If the first holder rolls back (say it was short on stock), the waiting checkout redeems the coupon, which is "never lost to a failed checkout" holding under contention.
- **Coupon generation:** two concurrent inserts can compute the same milestone; the second blocks on the unique index entry and `ON CONFLICT DO NOTHING` turns it into "no row", which is the clean `NO_ELIGIBLE_MILESTONE` refusal.
- **Report:** one statement reads one snapshot under `READ COMMITTED`, so it stays internally consistent without `REPEATABLE READ`.

**What changes or needs care:**

- **Lock ordering.** Checkout already decrements in product-id order, so two checkouts sharing products lock rows in the same order and queue rather than deadlock. Any new multi-row write must follow the same order.
- **Milestones from `COUNT(orders)`, not sequences.** Postgres sequences skip values on rollback, and every failed checkout rolls back, so "the order with id 5n" may never exist. A count of committed orders has no gaps. At volume, `COUNT(*)` on every generation becomes a scan; a counter row updated in the checkout transaction would fix that, at the price of a hot row every checkout updates, so I would only add it when generation latency matters.
- **Hot rows.** A popular product's row serializes its checkouts. That is the cost of exact stock. If one product dominates, split its stock into several bucket rows and decrement any bucket with enough units, or move to reservations.
- **Connection pooling** (PgBouncer in transaction mode) works because each checkout is one short transaction with no network calls inside it. The payment call, when added, stays outside it (outbox).
- **The driver swap** is a layer change: `@effect/sql-pg` instead of `@effect/sql-sqlite-node`. Repositories use the `SqlClient` interface, and migrations need dialect review (`STRICT` tables become typed columns; `RETURNING` and `ON CONFLICT` are already Postgres syntax).
- **Tests** would run against a real Postgres (for example in a CI service container), so the race tests would finally exercise database-level concurrency rather than fiber interleaving.
- **Reads at scale:** the report and lists can move to a read replica, accepting replica lag, or to a summary maintained in the checkout transaction.

## AI usage

I used Claude Code (Claude Opus) throughout, as a design partner and as the main code author, with every change reviewed, run and tested by me before it was committed.

**How I worked with it:**

1. **Design first.** I had it question me about the brief until the semantics were settled (carts, replay, coupons, money, errors), then write `SPEC.md` from that conversation. It then split the spec into ten tickets (`.scratch/checkout-rewards/issues/`), each with acceptance criteria.
2. **One ticket at a time, test first.** For each ticket it wrote the HTTP-level tests, then the implementation, then this file's section for the ticket. Each ticket ended with a review pass against the spec and the repo's conventions, which produced the "Tidy … after review" commits.
3. **Verifying, not trusting.** I ran mutation checks on the key tests: remove a guard or the transaction, confirm the test fails. This is how I learned that the coupon-generation race test passes even with the guard split into two statements and the unique constraint dropped, so its section says the guarantee rests on the single statement and the constraint, not on the test.

**Where I corrected or redirected it:**

- **`expectedTotal` → `expectedSubtotalCents`.** Its first design for the price guard had the client send the expected order total. I rejected that: the client would have to reimplement the discount rounding to know the total, and any change to the rounding rule would break clients. The client never computes discounts; it only knows the subtotal it showed. Since the discount is a deterministic function of the subtotal and the coupon, guarding the subtotal guards the total. The `Cents` suffix also makes the unit explicit.
- **Idempotency-Key header rejected in favour of the cart as the key.** It proposed the standard pattern: a client-supplied `Idempotency-Key` header, a table of keys with request fingerprints and stored responses, and an expiry policy. I pushed back because a cart can produce at most one order, already enforced by the conditional claim and `UNIQUE (cart_id)`. The header would add a second key, storage and expiry rules to protect an invariant the schema already holds. The result is the replay-versus-conflict rule (same coupon replays, different coupon conflicts), and the replay decision records when a header _would_ become necessary.
- **The report's transaction.** Its first report read the totals and the per-product rows as two `SELECT`s inside a transaction, for a consistent snapshot. In review I pointed out that the SQLite client starts every transaction with `BEGIN IMMEDIATE`, so a read-only report would take the write lock and block checkouts, and that on Postgres two statements need `REPEATABLE READ` to share a snapshot. It became one `SELECT`, consistent on both databases without a transaction.
- **Smaller corrections in review:** the product update field renamed from `inventory` to `availableInventory`, so the request and response use one name; hash-based SPA routes replaced with TanStack Router; repeated test helpers and schemas pulled into one place.

**What I own:** every line in the repository. I can explain each invariant and where it is enforced, predict the outcome of the concurrent scenarios in the walkthrough, and I have listed the weaknesses I know about below.

## What I would examine first with two more hours

1. **Run the suite against Postgres.** The race tests run on one SQLite connection, so they prove no database-level race. Adding a Postgres layer and running the oversell, retry, coupon and generation races against it, with real concurrent connections, would turn the `READ COMMITTED` arguments in this file from reasoning into evidence. This is the largest gap between what is claimed and what is tested.
2. **Bound the money inputs.** Prices and quantities have no upper bound beyond the integer type, and subtotal × percent must stay below 2⁵³ to remain exact. I would cap `unitPriceCents` (and therefore subtotals) in the schema and the table, with a test at the limit.
3. **Timing out a slow checkout.** A client that times out and retries while the first attempt is still running gets the replay only after the first commits; on SQLite the retry queues behind it. I would check what the client sees if the first attempt is still in flight for a long time, and whether a server-side timeout could commit after the client gave up (the replay covers it, but I would test it).
4. **Changing n at runtime.** The documented stall (lowering n can make the next milestone collide with an issued one) is a real failure mode if n is ever changed. Computing the next milestone from `MAX(milestone_order_count)` fixes it; I would make that change with a test.
5. **Coupon code collisions.** A 40-bit code collision fails generation with a `500` instead of retrying. It is negligible at this volume, but one retry on a primary-key conflict would remove it.

## Configuration

`n` and `x` are read from `COUPON_EVERY_N_ORDERS` (default 5, integer ≥ 1) and `COUPON_DISCOUNT_PERCENT` (default 10, integer 1–100). `DATABASE_PATH` and `PORT` are also read from the environment. Startup loads all of them through one validated `Config`, so an invalid value stops the process before it listens.

## Toolchain notes

- **Single Vitest instance.** `@effect/vitest` imports `vitest`. pnpm installs that as a different copy from the one `vp test` runs, which fails with "failed to find the current suite". The workspace overrides `vite` and `vitest` as the Vite+ docs recommend. That alone did not merge the copies (their peer sets still differed), so `apps/api/vite.config.ts` also inlines `@effect/vitest` and aliases `vitest` to `vite-plus/test`.
- **Tailwind v4 and shadcn under Vite+ (the open risk).** This worked without modification. `shadcn init -t vite` detected Vite and Tailwind v4 from a `vite.config.ts` that imports `defineConfig` from `vite-plus`. The only additions were the `@` path alias in `vite.config.ts` and `tsconfig.json`. Non-interactive init also needs a preset (`-p nova`). Because `vite` resolves to the Vite+ core (versioned 1.x), plugins report unmet `vite` peers, which `peerDependencyRules` allows.
- **orval fetch mutator.** orval's fetch client returns `{ data, status }` and does not throw on 4xx. A small mutator (`apps/web/src/api/fetcher.ts`) returns the body on success and throws an `ApiError` carrying `{ code, message, details }` otherwise, so TanStack Query surfaces API errors as errors.
