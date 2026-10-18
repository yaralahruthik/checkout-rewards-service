# Spec: Reliable Checkout and Rewards Service

## Problem Statement

An ecommerce store needs a backend where customers build carts and check out, and where purchasing activity is rewarded with a discount coupon after every *n*th successfully placed order.

The CRUD surface is simple; the hard part is behaving predictably under real-world conditions:

- Clients retry checkout after timeouts and must not create duplicate orders or double-charge inventory.
- Many customers check out at once against limited stock, and the store must never oversell.
- Prices and stock change between adding to cart and checking out, and customers must not be charged an amount they never saw.
- Two checkouts may race for the same coupon; a coupon must be redeemed at most once and must never be lost to a checkout that fails.
- Administrators need coupon generation that is safe to call repeatedly and concurrently, and a report that reconciles exactly with the orders and coupons the system returns.

Evaluators will exercise the service with concurrent and repeated requests and will probe the reasoning behind every invariant.

## Solution

A TypeScript monorepo containing:

- **An HTTP API** built with Effect, persisted in SQLite, described by a committed OpenAPI 3.1 document. Every invariant (no oversell, one order per cart, one redemption per coupon, one coupon per milestone) is enforced by a conditional write inside a single checkout transaction and backed by a schema constraint — so correctness does not depend on SQLite's single-writer lock and would hold on Postgres under READ COMMITTED.
- **A thin React SPA** that demonstrates the backend: browse products, manage a cart, check out with a coupon, view orders, and an admin page with coupon generation, reporting, product editing, and a "race it" button that visibly fires parallel checkouts at a limited-stock product.
- **A focused test suite** exercising races and retries through the HTTP API.
- **`DECISIONS.md`** recording invariants, ambiguities, design decisions, concurrency strategy, money rules, error model, deferrals, scale-out path, and AI usage.

## User Stories

### Catalog

1. As a shopper, I want to list all products with their current price and available stock, so that I can decide what to buy.
2. As a shopper, I want prices shown in exact cents, so that what I see is exactly what I'm charged.
3. As a shopper, I want to see when a product has limited stock, so that I know it may sell out.

### Cart

4. As a shopper, I want to create a cart without signing up, so that I can start shopping immediately.
5. As a shopper, I want my cart identifier to be unguessable, so that other people cannot view or modify my cart.
6. As a shopper, I want to set the quantity of a product in my cart, so that I can buy several units.
7. As a shopper, I want setting a quantity to be safe to retry, so that a network retry does not double the quantity in my cart.
8. As a shopper, I want to change the quantity of an item already in my cart, so that I can adjust my order.
9. As a shopper, I want to remove an item from my cart, so that I don't buy something I no longer want.
10. As a shopper, I want to be told clearly when I add a product that doesn't exist, so that invalid items never silently enter my cart.
11. As a shopper, I want to be told clearly when a quantity is zero, negative, fractional, or above the per-line maximum, so that I can correct it.
12. As a shopper, I want to be told when I ask for more units than are currently in stock, so that I don't build a cart that cannot be fulfilled.
13. As a shopper, I want to view my cart with each line's current unit price, line total, and the cart subtotal, so that I know what I'll pay.
14. As a shopper, I want my cart view to flag lines whose quantity now exceeds available stock, so that I can fix them before checking out.
15. As a shopper, I want my cart to reflect current prices rather than prices from when I added items, so that I always see the price I'll actually be charged.
16. As a shopper, I want my cart to stay available indefinitely, so that I can come back to it later.
17. As a shopper, I want my abandoned cart not to hold inventory, so that other shoppers aren't blocked by carts nobody will buy.
18. As a shopper, I want to be prevented from modifying a cart that has already been checked out, so that my order cannot diverge from what I purchased.
19. As a shopper, I want a checked-out cart to tell me which order it became, so that I can find my order.

### Checkout

20. As a shopper, I want to check out my cart and receive an order, so that my purchase is placed.
21. As a shopper, I want checkout to be safe to retry after a timeout, so that I never get two orders or pay twice.
22. As a shopper, I want a retried checkout to return the same order as the original, so that my client can recover from a lost response.
23. As a shopper, I want a clear error if I try to check out an already-checked-out cart with different details (such as a different coupon), so that I understand the first checkout already happened and which order it produced.
24. As a shopper, I want checkout to fail clearly when my cart is empty, so that I don't create empty orders.
25. As a shopper, I want checkout to fail clearly, listing the affected products, when there isn't enough stock, so that I know what to change.
26. As a shopper, I want checkout to fail if prices changed since I last viewed my cart, so that I'm never charged an amount I didn't see.
27. As a shopper, I want a price-changed failure to include the new totals, so that I can review and confirm them.
28. As a shopper, I want a failed checkout to leave my cart open and unchanged, so that I can fix the problem and try again.
29. As a shopper, I want a failed checkout to leave stock and my coupon untouched, so that nothing is consumed by an order that didn't happen.
30. As a shopper competing with others for limited stock, I want the store to never sell more units than exist, so that my confirmed order is always real.
31. As a shopper, I want to apply a coupon at checkout, so that I receive my discount.
32. As a shopper, I want a clear error if my coupon code is unknown, so that I can correct a typo.
33. As a shopper, I want a clear error if my coupon has already been redeemed, so that I understand why no discount applied.
34. As a shopper, I want the discount calculated deterministically and never to make my total negative, so that the price is predictable and sane.

### Orders

35. As a shopper, I want to retrieve my order by ID, so that I can review what I bought.
36. As a shopper, I want my order to show each product's name, unit price, quantity, and line total as they were at purchase, so that my receipt stays accurate even if the catalog changes later.
37. As a shopper, I want my order to show subtotal, discount, discount percent, coupon code, and total, so that I can see exactly how my total was calculated.

### Coupons and milestones

38. As a store owner, I want every *n*th successful order to make one coupon for *x*% off available, so that loyal purchasing is rewarded.
39. As an administrator, I want to generate a coupon when an unrewarded milestone has been reached, so that the reward is issued.
40. As an administrator, I want generation to refuse with a clear error when no milestone is eligible, so that coupons cannot be minted arbitrarily.
41. As an administrator, I want repeated or concurrent generation requests for the same milestone to produce exactly one coupon, so that double-clicks and retries never over-issue.
42. As an administrator, I want skipped milestones to be issued oldest-first, one per request, so that backlog is handled predictably.
43. As an administrator, I want each coupon to record the milestone and discount percent it was issued with, so that later configuration changes don't alter coupons already issued.
44. As an administrator, I want to list all coupons with their status (available or redeemed, and by which order), so that I can audit rewards.
45. As a shopper, I want a coupon to be redeemable exactly once even if two checkouts race for it, so that coupon use is fair and auditable.
46. As an operator, I want to configure *n* and *x* at startup with validation, so that the reward program can be tuned and invalid values are rejected early.

### Administration and reporting

47. As an administrator, I want to update a product's price, so that I can respond to market changes (and demonstrate price-change behavior).
48. As an administrator, I want to set a product's available inventory, so that I can restock or reflect shrinkage.
49. As an administrator, I want to list all orders, newest first, so that I can reconcile them against the report.
50. As an administrator, I want a report of purchased quantity per product, so that I know what sells.
51. As an administrator, I want gross revenue before discounts, total discounts, and net revenue in the report, so that I understand the financial effect of the rewards program.
52. As an administrator, I want counts of coupons generated, available, and redeemed, so that I can track the program's uptake.
53. As an administrator, I want the total number of successfully placed orders, so that I can see progress toward the next milestone.
54. As an administrator, I want the report to reconcile exactly with the orders and coupons the API returns, so that I can trust it.
55. As an administrator, I want viewing the report to never change any state, so that I can refresh it freely.
56. As an administrator, I want administrative operations grouped under a distinct path, so that they can be protected by authentication later.

### API clients and developers

57. As an API client developer, I want every error to have a stable machine-readable code, a human message, and structured details, so that I can handle each failure correctly.
58. As an API client developer, I want distinct HTTP statuses for validation errors, missing resources, conflicts, and unprocessable requests, so that generic HTTP tooling behaves sensibly.
59. As an API client developer, I want an OpenAPI document listing every endpoint, request, response, and error code, so that I can generate a typed client.
60. As an API client developer, I want interactive API docs served by the service, so that I can explore it without reading code.
61. As an evaluator, I want executable request examples that cover the happy path, retries, and conflicts, so that I can reproduce the interesting behavior quickly.
62. As an evaluator, I want one command to install, one to run everything, and one to run tests, so that setup is repeatable without private services or credentials.
63. As an evaluator, I want seed data with at least five products including one with limited stock, so that I can exercise the service immediately.
64. As an evaluator, I want a command to reset the database to its seeded state, so that I can rerun scenarios from scratch.
65. As an evaluator, I want CI to run lint, type checks, tests, and an OpenAPI drift check, so that I know the suite passes outside the author's machine.

### Demo frontend

66. As an evaluator, I want a product list page where I can add items to a cart, so that I can drive the API visually.
67. As an evaluator, I want a cart page that shows live totals and lets me edit quantities, enter a coupon, and check out, so that I can see validation and pricing behavior.
68. As an evaluator, I want the SPA to ask me to confirm when prices changed before checkout, so that I can see the price-change contract in action.
69. As an evaluator, I want errors shown as readable messages keyed by error code, so that failure modes are visible.
70. As an evaluator, I want a manual "retry checkout" action that returns the same order, so that I can see idempotent replay.
71. As an evaluator, I want an order page showing the snapshot lines and discount breakdown, so that I can see what was recorded.
72. As an evaluator, I want an admin page to generate coupons, list coupons and orders, edit products, and view the report, so that I can exercise the admin operations.
73. As an evaluator, I want a "race it" button that fires many parallel checkouts at the limited-stock product and shows how many succeeded versus were rejected, so that I can watch the no-oversell guarantee hold.
74. As a shopper using the SPA, I want my cart remembered across page reloads, so that I don't lose it.
75. As a shopper using the SPA, I want checkout never to be automatically retried behind my back, so that retries are explicit and visible.

## Implementation Decisions

### Repository and tooling

- pnpm workspace monorepo, with Vite+ as the task runner, linter/formatter, and test runner. Node 24 LTS is pinned.
- Two apps, an API and a web SPA, plus one shared TypeScript config package. There is no shared contract package: the committed OpenAPI document is the contract between them, because the SPA never imports Effect.
- Feature-driven folders in both apps.
  - API features: products, carts, checkout, orders, coupons, admin report. Each holds its endpoint group and schemas, handlers, service, repository, tagged errors, and colocated tests.
  - Cross-cutting code (database layer, migrations, seed, money helpers, config) lives in a shared area.
  - Web features: catalog, cart, orders, admin. Generated client code is git-ignored and regenerated before dev and build.
- One root dev command runs both apps. The web dev server proxies all API routes to the API server, so there is no CORS configuration.

### Backend architecture

- Effect 4, using its built-in HTTP API and SQL modules, the Node platform package, and the SQLite-on-Node driver (built on `node:sqlite`).
- Each feature exposes an Effect service wired with Layers. Repositories depend on the SQL client.
- Request, response, and error shapes are defined once as Effect Schemas. They drive validation, the OpenAPI document, and error typing.
- Time and ID generation are injected services, so tests can be deterministic.
- Checkout is its own feature. It orchestrates carts, products, coupons, and orders inside one transaction, and does not live inside the carts feature.
- The OpenAPI document is produced from the API definition by a generation script and committed. A test fails if the committed document drifts from the code.
- Interactive API docs (Scalar) are served by the service.

### Configuration

- `n` (milestone interval) and `x` (discount percent) come from environment variables, validated at startup. Defaults are n = 5 and x = 10. Constraints: n ≥ 1 and 1 ≤ x ≤ 100.
- The database file path comes from an environment variable with a local default.

### Domain model and schema

- **Product:** id, name, unit price in cents, available inventory. Inventory has a non-negative check constraint.
- **Cart:** UUIDv7 id (the bearer credential), status `OPEN` or `CHECKED_OUT`, created timestamp.
- **Cart line:** cart id, product id, quantity (integer, 1–99). Unique per cart and product. No price is stored on the line, because prices are always read live.
- **Order:**
  - Identity and links: UUIDv7 id, cart id (unique, which enforces one order per cart), created timestamp.
  - Amounts: subtotal cents, discount cents, total cents.
  - Coupon fields (nullable): coupon code and discount percent.
- **Order line snapshot:** order id, product id, product name, unit price cents, quantity, line total cents. These are copied at checkout and never joined live to products.
- **Coupon:**
  - Code: unique, of the form `SAVE<x>-` plus 8 characters of Crockford base32 from cryptographic randomness.
  - Milestone order count: unique, which enforces one coupon per milestone.
  - Discount percent, snapshotted at generation.
  - Created timestamp.
  - Redemption fields (nullable): redeemed order id and redeemed timestamp.
- Migrations are numbered and run on startup.
- The seed is idempotent: it inserts six products only when the catalog is empty. One product has stock 3. One is priced so that a 10% discount yields a fractional cent (e.g. 1999 cents).
- A reset command restores the seeded state.

### Money

- All amounts are integer minor units (cents) in one implicit currency (USD). They are stored as integers and exposed as integer fields suffixed `Cents`. No floating-point value appears anywhere on a money path.
- Line total = unit price × quantity. Subtotal = sum of line totals.
- Discount = floor(subtotal × percent / 100). The floor never over-discounts, and the result is clamped so the total is never below zero.
- Total = subtotal − discount.

### Cart semantics

- Cart states: `OPEN` → `CHECKED_OUT`. There is no other transition. A failed checkout leaves the cart `OPEN`.
- Items are managed with set-quantity semantics, which makes them idempotent under retries:
  - setting a product's quantity creates the line or replaces its quantity;
  - removing a product deletes the line.
  - There is no increment operation.
- Validation on set: the product must exist, and the quantity must be an integer from 1 to 99. A soft stock check rejects a quantity greater than current inventory. Checkout re-validates authoritatively.
- Any mutation of a non-open cart is rejected.
- The cart view returns:
  - each line with live unit price, line total, current available inventory, and an insufficient-stock flag;
  - subtotal, item count, and status;
  - the order id once checked out.
  - The cart view does not preview coupon discounts.
- Carts never expire and hold no inventory.

### Checkout semantics (single transaction, in this order)

1. **Claim the cart** with a conditional update from `OPEN` to `CHECKED_OUT`. If no row changed:
   - Cart missing → not found.
   - Cart already checked out and the request's coupon code matches the existing order's → **replay**: return the existing order with 200. An expected subtotal is ignored on replay.
   - Otherwise → conflict "cart already checked out", including the existing order id.
2. **Load lines.** An empty cart → empty-cart error.
3. **Price lines** at current prices and compute the subtotal.
4. **Price guard.** If the client supplied an expected subtotal in cents and it differs from the computed subtotal → price-changed error carrying the new totals. The subtotal is guarded rather than the final total because the client never computes discounts, and the discount is a deterministic function of the subtotal and the coupon.
5. **Decrement inventory** for each line, in product-id order, with a conditional update that only succeeds when inventory ≥ quantity.
   - If any line fails → insufficient-inventory error listing every short line, with requested and available quantities.
   - The product-id ordering doesn't matter on SQLite, but it prevents deadlocks on Postgres.
6. **Redeem the coupon**, if supplied:
   - Unknown code → coupon-invalid error.
   - Otherwise, a conditional update that only succeeds while the redeemed order id is null. If no row changes → coupon-already-redeemed error.
   - The discount uses the coupon's snapshotted percent.
7. **Insert** the order and its line snapshots.
8. **Commit** and return 201 with the order.

Any failure at any step rolls back the whole transaction: the cart returns to `OPEN`, inventory is unchanged, and the coupon stays available.

Every invariant has a guard in the statement and a constraint in the schema:

- conditional inventory decrement plus a non-negative check;
- conditional cart claim plus a unique cart id on orders;
- conditional coupon redemption;
- unique milestone on coupons;
- unique coupon code.

SQLite's single-connection, `BEGIN IMMEDIATE` serialization is a second line of defense and is not relied upon. `DECISIONS.md` states this explicitly, along with why the cart serves as the natural idempotency key, which makes a client-supplied idempotency-key header unnecessary here, and when such a header would become necessary.

### Payment

- No payment integration. A committed checkout is treated as payment success.
- `DECISIONS.md` describes the deferred design: create the order as pending, charge, then confirm or compensate, with an outbox.

### Coupon generation semantics

- Milestones are counted from the count of successful orders, not from an id sequence. That keeps them gap-free if the database moves to Postgres sequences.
- Every successful order counts, including discounted ones.
- The next milestone is (coupons generated + 1) × n. Generation is eligible when the order count has reached it.
- Each request issues at most one coupon, for the oldest unrewarded milestone. The unique milestone constraint makes concurrent requests issue exactly one coupon; the losers receive a no-eligible-milestone error.
- Coupons are bearer codes: no customer binding, no expiry, one coupon per order, applied to the whole subtotal.
- Changing n later reinterprets future milestones as multiples of the new n. Already-issued coupons are unaffected. This is documented, not engineered.

### Reporting semantics

- Computed on read from orders, order line snapshots, and coupons. There are no stored counters.
- The report contains:
  - quantity per product, grouped from line snapshots;
  - gross revenue = sum of subtotals;
  - discounts = sum of discounts;
  - net revenue = sum of totals;
  - coupons generated, available, and redeemed;
  - total successful orders.
- The report is a read-only GET and never writes.

### API contract

All routes are under an `/api` prefix.

**Public endpoints:**

| Endpoint | Purpose |
| --- | --- |
| List products | Catalog with live prices and stock |
| Create cart | Returns 201 |
| Get cart | Cart view described above |
| Set item quantity | PUT on the cart's item for a product |
| Remove item | DELETE on the cart's item for a product |
| Checkout | Body: optional coupon code, optional expected subtotal in cents. Returns 201 when created, 200 on replay |
| Get order | Order with its line snapshots |

**Administrative endpoints** (grouped under an admin prefix, with no authentication but a single seam where it would be added):

| Endpoint | Purpose |
| --- | --- |
| Generate coupon | Issues the coupon for the oldest unrewarded milestone |
| List coupons | All coupons with their status |
| List orders | All orders, newest first |
| Get report | The read-only report |
| Update product | Partial update of price and/or inventory (absolute set, non-negative) |

**Error shape:** every error body has a stable `code`, a human-readable `message`, and structured `details`. Each endpoint declares its possible codes in the OpenAPI document.

| Status | Codes |
| --- | --- |
| 400 | VALIDATION_ERROR |
| 404 | CART_NOT_FOUND, PRODUCT_NOT_FOUND, ORDER_NOT_FOUND |
| 409 | INSUFFICIENT_INVENTORY, PRICE_CHANGED, CART_NOT_OPEN, CART_ALREADY_CHECKED_OUT, COUPON_ALREADY_REDEEMED, NO_ELIGIBLE_MILESTONE |
| 422 | COUPON_INVALID, EMPTY_CART |

**Documentation:**

- the committed OpenAPI document;
- served interactive docs;
- an executable request-examples file covering the happy path, retries, and conflicts;
- an endpoint table in the README with statuses and error codes.

### Frontend

- React SPA using Tailwind v4 and shadcn components. Hooks and types are generated by orval (TanStack Query v5 client) from the committed OpenAPI document. Responses are not validated at runtime.
- The cart id is persisted in local storage.
- Checkout always sends the expected subtotal shown on screen. On price-changed, a dialog shows the new totals, and confirming resends with the new value.
- Other errors become toasts keyed by error code.
- Checkout mutations have automatic retry disabled. A manual retry action demonstrates replay.
- The admin page includes coupon generation, coupon and order lists, the report, product editing, and the "race it" demo, which fires N parallel checkouts from N fresh carts at the limited-stock product and tallies the outcomes.

### Process

- Build order:
  1. scaffold;
  2. schema, migrations, and seed;
  3. products and carts;
  4. checkout;
  5. coupons;
  6. report;
  7. OpenAPI emission and docs;
  8. frontend;
  9. finalize `DECISIONS.md`.
- Roughly one commit per step. `DECISIONS.md` is written incrementally, and its AI-usage section cites concrete redirections from the design session.
- If time runs short, the frontend is cut before the tests.

## Testing Decisions

### What makes a good test here

- Tests exercise **external behavior only**, through a **single seam: the HTTP API**. Requests go through the real API handlers, via Effect's HTTP API test client, against a fresh in-memory SQLite database. The database is migrated and seeded through the same layer the server uses.
- Assertions are made only on HTTP status, error `code`, response bodies, and follow-up API reads (cart, order, products, coupons, report). Tests never inspect database tables or call services or repositories directly. Swapping the database or restructuring services therefore must not break any test.
- Concurrency tests fire genuinely overlapping requests (parallel fibers) and assert on aggregate outcomes. Even though the SQLite client serializes transactions, these tests catch the realistic class of bug, check-then-act across an await: for example, reading stock in a handler and writing it in a separate step. Fibers interleave between the read and the write, so such an implementation fails. This rationale goes in `DECISIONS.md`.
- Time and ID services are injected only where a test needs deterministic values. They are not separate seams.
- A small number of meaningful tests is preferred over broad superficial coverage.

### Tests to write

1. **Oversell race.** Ten carts, each holding one unit of the stock-3 product, check out in parallel.
   - Exactly three succeed and seven receive INSUFFICIENT_INVENTORY.
   - The product shows zero inventory afterwards.
   - The successful orders sum to three units.
2. **Retry storm.** The same cart is checked out ten times concurrently.
   - Exactly one order exists.
   - Every success response carries the same order id: one 201 and the rest 200 replays.
   - Inventory is decremented exactly once.
   - A subsequent checkout with a different coupon receives CART_ALREADY_CHECKED_OUT with the order id.
3. **Coupon race.** Two carts check out concurrently with the same valid coupon.
   - Exactly one succeeds with the discount; the other receives COUPON_ALREADY_REDEEMED.
   - The losing cart is still `OPEN`, and its products' inventory is unchanged.
4. **Coupon survives a failed checkout.** A checkout supplying a valid coupon fails on insufficient inventory.
   - Afterwards the coupon is listed as available.
   - A later valid checkout redeems it successfully.
5. **Generation race.** At exactly one eligible milestone, five generate requests run concurrently.
   - Exactly one coupon is created; the others receive NO_ELIGIBLE_MILESTONE.
   - A further request before the next milestone is also refused.
6. **Report reconciliation and read-only behavior.** After a mixed scenario (discounted and undiscounted orders, some failures):
   - the report's per-product quantities, gross, discounts, net, coupon counts, and order count equal the sums over the listed orders and coupons;
   - gross − discounts = net;
   - two consecutive report requests return identical bodies, and the listed orders and coupons are unchanged.
7. **Price change, snapshot, and rounding.**
   - After an item is added, an admin raises its price. Checkout with the stale expected subtotal receives PRICE_CHANGED with the new totals, and the cart remains open.
   - Checkout with the new subtotal succeeds.
   - A later price change does not alter the retrieved order's line snapshot.
   - A 10% coupon on a 1999-cent subtotal yields a 199-cent discount and a 1800-cent total.

### Other checks

- An OpenAPI drift test fails when the committed document differs from the one generated from code.
- A pure unit test of the discount function is permitted only if rounding edge cases prove awkward to reach through checkout. Otherwise test 7 covers them through the API.
- The frontend has no automated tests. The "race it" button and manual retry are demonstrations, not tests.

### Prior art

None. The repository is empty. These tests establish the pattern: a per-test layer providing a fresh migrated and seeded in-memory database, plus an HTTP test client, used via the Effect Vitest integration.

## Out of Scope

- Authentication and authorization. Admin routes are grouped under one prefix with a single seam where auth would be added.
- Real payment processing, and the pending→charge→confirm/compensate flow with an outbox. This is documented only.
- Postgres and multiple application instances. The scale-out design is described in `DECISIONS.md` but not built.
- Pagination of order and coupon lists.
- Cart expiry, TTL, or cleanup.
- Per-customer coupons, customer accounts, and coupon expiry.
- Multiple currencies.
- Rate limiting.
- Reserving inventory when adding to the cart.
- Observability beyond Effect's built-in logging.
- Automated frontend tests.
- Runtime response validation in the SPA.

## Further Notes

- **Timebox: 4–6 hours.** Backend correctness and the race tests take priority. The frontend is the first thing cut under time pressure, and anything incomplete will be stated plainly in the README with the approximate time spent.
- The `DECISIONS.md` section on multiple instances should cover:
  - moving to Postgres, where every existing conditional update and unique constraint carries over unchanged;
  - the product-id lock ordering;
  - why `COUNT(orders)` is used instead of sequences;
  - that the SQLite file is the only component that does not scale out.
- Verified toolchain facts as of 2026-10-18:
  - Effect 4.0.5 is stable, with HTTP API and SQL in core.
  - The SQLite-on-Node client uses a single connection, a semaphore, `BEGIN IMMEDIATE`, and WAL.
  - Vite+ 1.3.0 bundles Vitest 5, which matches the Effect Vitest peer range.
  - orval 8.43 supports OpenAPI 3.1 with TanStack Query v5.
  - shadcn 4.22 supports Vite with Tailwind v4.
- Open risk: whether shadcn's Vite setup works unmodified under Vite+'s Vite core is unverified. Check it first when scaffolding the web app.
- The engineering team's own working terms are: Cart, Line, Order, Order snapshot, Milestone, Coupon, Redemption, Report.
