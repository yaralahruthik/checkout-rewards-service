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

**Money and rounding:**

- All amounts are integer cents. Discount = floor(subtotal × percent / 100), clamped to the subtotal; total = subtotal − discount. `discountCents` in `apps/api/src/shared/money.ts` computes the floor without floating point: it subtracts the remainder of subtotal × percent modulo 100 before dividing, so the division is exact.
- **Rounding down** never over-discounts: the store gives at most x%, never a fraction of a cent more. 10% of 1999 is 199, so the total is 1800 (test 7).
- **The clamp** cannot trigger while percent is at most 100 (checked on the coupon row), but it keeps "never negative" true by construction, and the order table's `CHECK (total_cents >= 0)` backs it.
- **The discount applies to the whole subtotal.** There are no per-product or per-category coupons, so a line-by-line discount would only add rounding drift (floors of lines summing to less than the floor of the total).

**One coupon per order.** `couponCode` is a single optional string. Stacking would raise questions the brief does not answer (applied to the subtotal or to each other's result, in what order) and makes the discount depend on that order. One code per order keeps the discount a function of the subtotal and one percent.

**Portable to Postgres under READ COMMITTED.** Two checkouts with the same code both run the `UPDATE`; the second blocks on the row lock of the first, then re-evaluates `redeemed_order_id IS NULL` against the committed row. If the first committed, the second changes no row and is refused; if the first rolled back (say, on stock), the second redeems it. That last case is the "never lost to a failed checkout" rule holding under contention.

**What the race test proves:** test 3 (`checkout.test.ts`) fires two checkouts with the same code concurrently and asserts one `201` with the discount and one `COUPON_ALREADY_REDEEMED`, with the loser's cart `OPEN` and stock unchanged. A mutation check (dropping `AND redeemed_order_id IS NULL`) made it fail: the second update then overwrites the first redemption and the unique index on `orders.coupon_code` rejects the insert, which surfaces as a 500 instead of a clean 409.

**Consequences:** A shopper whose coupon is taken by someone else gets a clear 409 and can check out the same cart without it. The cart view does not preview discounts (SPEC.md); the order shows the discount line once placed.

## Configuration

`n` and `x` are read from `COUPON_EVERY_N_ORDERS` (default 5, integer ≥ 1) and `COUPON_DISCOUNT_PERCENT` (default 10, integer 1–100). `DATABASE_PATH` and `PORT` are also read from the environment. Startup loads all of them through one validated `Config`, so an invalid value stops the process before it listens.

## Toolchain notes

- **Single Vitest instance.** `@effect/vitest` imports `vitest`. pnpm installs that as a different copy from the one `vp test` runs, which fails with "failed to find the current suite". The workspace overrides `vite` and `vitest` as the Vite+ docs recommend. That alone did not merge the copies (their peer sets still differed), so `apps/api/vite.config.ts` also inlines `@effect/vitest` and aliases `vitest` to `vite-plus/test`.
- **Tailwind v4 and shadcn under Vite+ (the open risk).** This worked without modification. `shadcn init -t vite` detected Vite and Tailwind v4 from a `vite.config.ts` that imports `defineConfig` from `vite-plus`. The only additions were the `@` path alias in `vite.config.ts` and `tsconfig.json`. Non-interactive init also needs a preset (`-p nova`). Because `vite` resolves to the Vite+ core (versioned 1.x), plugins report unmet `vite` peers, which `peerDependencyRules` allows.
- **orval fetch mutator.** orval's fetch client returns `{ data, status }` and does not throw on 4xx. A small mutator (`apps/web/src/api/fetcher.ts`) returns the body on success and throws an `ApiError` carrying `{ code, message, details }` otherwise, so TanStack Query surfaces API errors as errors.
