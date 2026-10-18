# Checkout and Rewards Service

A checkout backend that stays correct when requests are retried, shoppers race for the same stock, prices change mid-checkout, and two checkouts compete for one coupon. Every n-th successful order makes one x% coupon available.

- **API:** TypeScript, [Effect 4](https://effect.website) HTTP API, SQLite through Node's built-in `node:sqlite`. Every invariant is enforced by a conditional write (checkout's all in one transaction) and backed by a schema constraint.
- **Demo SPA:** React, Tailwind and shadcn, generated from the committed OpenAPI document. It drives the API; it is not part of the evaluation surface.

| Document                                                               | What it holds                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`DECISIONS.md`](DECISIONS.md)                                         | Invariants, ambiguities, design decisions, concurrency, money, errors, deferrals, scale-out and AI usage |
| [`apps/api/openapi.json`](apps/api/openapi.json)                       | The OpenAPI 3.1 contract, generated from code; CI fails if it drifts                                     |
| [`apps/api/examples/walkthrough.ts`](apps/api/examples/walkthrough.ts) | Executable request examples, including retries, races and conflicts                                      |
| [`SPEC.md`](SPEC.md)                                                   | The spec written before building                                                                         |
| [`BRIEF.md`](BRIEF.md)                                                 | The assignment brief                                                                                     |

## Setup

**Prerequisites:** Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable` picks up the pinned version). No database server, Docker or credentials.

```sh
pnpm install
pnpm dev        # API on http://localhost:3000, SPA on http://localhost:5173
```

The API creates `apps/api/data/store.db` on first start, runs the migrations and seeds six products. The seed only runs into an empty catalog, so restarts keep your data.

| Command                            | What it does                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                         | API (restarts on change) and SPA together; the SPA proxies `/api` to the API              |
| `pnpm --filter @uniblox/api start` | The API alone                                                                             |
| `pnpm test`                        | The API test suite, each test on a fresh in-memory database                               |
| `pnpm check`                       | Format, lint and type check                                                               |
| `pnpm examples`                    | The request walkthrough against a running API (see [Request examples](#request-examples)) |
| `pnpm db:reset`                    | Drops every table, re-runs the migrations and the seed. Stop the API first.               |
| `pnpm openapi`                     | Regenerates `apps/api/openapi.json` after a contract change                               |

### Environment variables

All are optional. They are validated at startup, and an invalid value stops the API before it listens.

| Variable                  | Default                  | Meaning                                                        |
| ------------------------- | ------------------------ | -------------------------------------------------------------- |
| `COUPON_EVERY_N_ORDERS`   | `5`                      | **n**: every n-th successful order is a coupon milestone (≥ 1) |
| `COUPON_DISCOUNT_PERCENT` | `10`                     | **x**: the percent a generated coupon takes off (1–100)        |
| `DATABASE_PATH`           | `apps/api/data/store.db` | SQLite file; `:memory:` for a throwaway database               |
| `PORT`                    | `3000`                   | API port                                                       |
| `API_PORT`                | `3000`                   | Where the SPA dev server proxies `/api`                        |
| `API_URL`                 | `http://localhost:3000`  | Where `pnpm examples` sends requests                           |

For example, `COUPON_EVERY_N_ORDERS=2 COUPON_DISCOUNT_PERCENT=25 pnpm dev`.

### Seed data

| Id  | Product                     | Price (cents) | Stock | Why                                        |
| --- | --------------------------- | ------------- | ----- | ------------------------------------------ |
| 1   | Mechanical Keyboard         | 8999          | 25    |                                            |
| 2   | Wireless Mouse              | 2499          | 40    |                                            |
| 3   | USB-C Hub                   | 3499          | 30    |                                            |
| 4   | Laptop Stand                | 1999          | 20    | 10% off is 199.9 cents: exercises rounding |
| 5   | Noise-Cancelling Headphones | 14999         | 15    |                                            |
| 6   | Limited Edition Keycap Set  | 4999          | 3     | Limited stock: the oversell demo           |

## API

Interactive docs (Scalar) are served at **<http://localhost:3000/api/docs>**, and the OpenAPI document at `/api/openapi.json` (committed as [`apps/api/openapi.json`](apps/api/openapi.json)). All routes are under `/api`, and all money is integer cents.

Every error body is `{ "code": "STABLE_CODE", "message": "…", "details": { … } }`. Any endpoint that takes a path parameter or a body can return `400 VALIDATION_ERROR`, with `details.location` and a list of `{ path, message }` issues. The full error model is in [`DECISIONS.md`](DECISIONS.md#error-model).

### Shopper endpoints

| Method   | Path                                | Purpose                                                                                 | Success                            | Errors                                                                                                                                                                                |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/products`                     | Catalog with current prices and stock                                                   | `200` products                     | —                                                                                                                                                                                     |
| `POST`   | `/api/carts`                        | Create an empty cart; its UUIDv7 id is the only credential                              | `201` cart                         | —                                                                                                                                                                                     |
| `GET`    | `/api/carts/{id}`                   | Cart priced at current prices, with per-line stock flags and `orderId` once checked out | `200` cart                         | `400`, `404 CART_NOT_FOUND`                                                                                                                                                           |
| `PUT`    | `/api/carts/{id}/items/{productId}` | Set a line's quantity (`{ "quantity": 1–99 }`); replaces, never adds                    | `200` cart                         | `400`, `404 CART_NOT_FOUND`, `404 PRODUCT_NOT_FOUND`, `409 CART_NOT_OPEN`, `409 INSUFFICIENT_INVENTORY`                                                                               |
| `DELETE` | `/api/carts/{id}/items/{productId}` | Remove a line; removing an absent line is a no-op                                       | `200` cart                         | `400`, `404 CART_NOT_FOUND`, `409 CART_NOT_OPEN`                                                                                                                                      |
| `POST`   | `/api/carts/{id}/checkout`          | Place the order. Body (optional): `{ couponCode?, expectedSubtotalCents? }`             | `201` order, `200` order on replay | `400`, `404 CART_NOT_FOUND`, `409 CART_ALREADY_CHECKED_OUT`, `409 PRICE_CHANGED`, `409 INSUFFICIENT_INVENTORY`, `409 COUPON_ALREADY_REDEEMED`, `422 EMPTY_CART`, `422 COUPON_INVALID` |
| `GET`    | `/api/orders/{id}`                  | An order with its line snapshots and discount breakdown                                 | `200` order                        | `400`, `404 ORDER_NOT_FOUND`                                                                                                                                                          |

### Admin endpoints

Administrative operations live under **`/api/admin`**. There is no authentication; one middleware (`apps/api/src/shared/admin.ts`) is the seam where it would go.

| Method  | Path                          | Purpose                                                                                 | Success       | Errors                         |
| ------- | ----------------------------- | --------------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| `PATCH` | `/api/admin/products/{id}`    | Set price and/or stock: `{ unitPriceCents?, availableInventory? }`, absolute values     | `200` product | `400`, `404 PRODUCT_NOT_FOUND` |
| `POST`  | `/api/admin/coupons/generate` | Issue one coupon for the oldest milestone reached but not yet rewarded                  | `201` coupon  | `409 NO_ELIGIBLE_MILESTONE`    |
| `GET`   | `/api/admin/coupons`          | Every coupon with `AVAILABLE`/`REDEEMED` status and the redeeming order                 | `200` coupons | —                              |
| `GET`   | `/api/admin/orders`           | Every order with its lines, newest first                                                | `200` orders  | —                              |
| `GET`   | `/api/admin/report`           | Quantity sold per product, gross, discounts, net, coupon counts, order count; read-only | `200` report  | —                              |

### Behaviour worth knowing

- **Checkout retries.** The cart is the idempotency key. Re-sending a checkout with the same coupon code (or none) returns the original order with `200` instead of `201`. A different coupon code gets `409 CART_ALREADY_CHECKED_OUT` with the `orderId`.
- **Price changes.** Carts hold no prices; they always show current ones. Send the subtotal the shopper saw as `expectedSubtotalCents` and checkout refuses with `409 PRICE_CHANGED` (carrying the new totals) if it moved. Omit it to accept current prices.
- **Failed checkouts change nothing.** The cart stays `OPEN`, no stock moves and the coupon stays available.
- **Coupons** are bearer codes like `SAVE10-7KQ2M9XA`, redeemable once, one per order, discount = floor(subtotal × x / 100).

## Request examples

[`apps/api/examples/walkthrough.ts`](apps/api/examples/walkthrough.ts) is an executable walkthrough. With the API running:

```sh
pnpm examples
```

It prints every request and response, and checks each against the documented status and error code, exiting non-zero on any surprise. CI runs it against a freshly started API. In order, it covers:

1. **Happy path:** build a cart, retry a `PUT` (the quantity is not doubled), remove a line, check out with the subtotal on screen, read the order.
2. **Retried checkout:** the same checkout again returns `200` with the same order; then five concurrent checkouts of one cart give one `201`, four `200`s, one order and one stock decrement.
3. **Conflicting checkout:** a different coupon on a checked-out cart is `409 CART_ALREADY_CHECKED_OUT`; editing it is `409 CART_NOT_OPEN`.
4. **Price change:** an admin raises a price after the shopper viewed the cart; checkout is `409 PRICE_CHANGED`, the cart stays open, checkout at the new subtotal succeeds, and the order keeps that price after the catalog changes back.
5. **Oversell:** five concurrent checkouts for the last two keycap sets give two `201`s, three `409 INSUFFICIENT_INVENTORY`, and stock 0.
6. **Validation and not-found errors** for each error code not shown elsewhere.
7. **Coupon generation:** drains any reached milestones, places orders up to the next one, then fires three concurrent generate requests: one `201`, two `409 NO_ELIGIBLE_MILESTONE`.
8. **Redemption and double redemption:** two concurrent checkouts with that coupon give one `201` (199 cents off 1999 at the default x = 10) and one `409 COUPON_ALREADY_REDEEMED` whose cart is still open.
9. **Report:** two reads are identical, and every figure is re-derived from the order and coupon lists.

It can be run repeatedly against the same database: when earlier runs have sold a product it needs too low, it restocks it through the admin update, and when it completes it has put back the prices and the keycap stock it changed. Its orders and coupons are real, so they stay in the report. If a run fails part-way, `pnpm db:reset` (with the API stopped) restores the seeded state.

## Tests

`pnpm test` runs the suite in `apps/api/src/**/*.test.ts`. Every test goes through the real HTTP handlers against a fresh, migrated and seeded in-memory database, and asserts only on responses and follow-up API reads. The ones that matter most:

| Test                                                   | Risk it covers                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Oversell race (`checkout.test.ts`)                     | Ten parallel checkouts for stock 3: exactly 3 succeed, stock ends at 0            |
| Retry storm (`checkout.test.ts`)                       | Ten parallel checkouts of one cart: one order, one decrement, same order id       |
| Coupon race (`checkout.test.ts`)                       | Two checkouts with one coupon: one redeems, the loser's cart and stock untouched  |
| Coupon survives a failed checkout (`checkout.test.ts`) | A checkout failing on stock leaves its coupon available                           |
| Generation race (`coupons.test.ts`)                    | Five parallel generate requests at one milestone issue one coupon                 |
| Report reconciliation (`report.test.ts`)               | The report equals sums over the listed orders and coupons, and never changes them |
| Price change, snapshot, rounding (`checkout.test.ts`)  | Stale subtotal refused; snapshots survive catalog changes; 1999 × 10% → 199       |
| OpenAPI drift (`openapi.test.ts`)                      | The committed contract matches the code                                           |

[`DECISIONS.md`](DECISIONS.md) explains what the race tests can and cannot prove on a single SQLite connection.

## Demo: "Race it"

The admin page (`/admin` in the SPA, started with `pnpm dev`) has a **Race it** panel that shows the no-oversell guarantee holding live:

1. Set **Parallel checkouts** (default 10) and **Starting stock** (default 3).
2. Press **Race it**. The panel sets the Limited Edition Keycap Set's inventory to the starting stock through the admin product update. It then creates one fresh cart per checkout, each holding one unit, and fires every checkout at once.
3. The tally shows the successes, the `INSUFFICIENT_INVENTORY` rejections, any other errors by code, and the product's final inventory, which must equal starting stock minus successes and never go below zero.

The panel uses only the public and admin API endpoints. The race's orders are real: they appear in the order list and the report, and they count towards coupon milestones. A browser opens only about six HTTP/1.1 connections per origin, so not all checkouts overlap at once. It is a demonstration, not a test. The oversell race test in the API suite guards the invariant.

The rest of the SPA: the catalog (`/`) adds to a cart remembered in local storage; the cart page (`/cart`) edits quantities, takes a coupon and asks you to confirm when prices changed; the order page has a **Retry checkout** button that shows the replay; the admin page also edits products, generates and lists coupons, lists orders and shows the report.

## Time spent and status

About **4 hours**: roughly 1½ hours on design (the spec, the invariants and the ticket breakdown) and the rest building, testing and documenting, in the increments the commit history shows.

Everything in [`SPEC.md`](SPEC.md) is implemented; nothing in scope is unfinished. What was deliberately left out (authentication, real payments, Postgres and multiple instances, pagination, cart expiry, frontend tests) is listed in [`DECISIONS.md`](DECISIONS.md#implemented-versus-deferred) with how each would be added.

## Repository layout

```
apps/api/                 Effect HTTP API
  src/Api.ts              API definition: the source of the OpenAPI document
  src/features/<feature>/ products, carts, checkout, orders, coupons, report:
                          endpoint schemas (*Api.ts), handlers (*.http.ts),
                          service, repository, tests
  src/shared/             config, error shape, admin seam, money, ids, database,
                          migrations, seed
  src/scripts/            OpenAPI generation, database reset
  src/testing/            test layer and shopper helpers
  examples/walkthrough.ts executable request examples
apps/web/                 demo SPA (catalog, cart, orders, admin)
packages/tsconfig/        shared compiler settings
```
