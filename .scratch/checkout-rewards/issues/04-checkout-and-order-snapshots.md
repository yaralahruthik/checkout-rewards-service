# 04: Checkout and order snapshots

**What to build:** A shopper can check out an open cart, and in one transaction the system claims the cart, prices it, decrements inventory without overselling, and records an order whose line snapshots explain exactly what was bought and how the total was calculated. The shopper can retrieve that order. Concurrent checkouts against limited stock never oversell. See SPEC.md (Checkout semantics, steps 1–3, 5, 7–8; Money).

**Blocked by:** 03 — Carts

**Status:** done

- [x] `POST /api/carts/{id}/checkout` runs as a single transaction: claim the cart with a conditional `OPEN`→`CHECKED_OUT` update, load lines, price them at current prices, decrement inventory conditionally (only when inventory ≥ quantity) in product-id order, insert the order and its line snapshots, commit
- [x] Success returns 201 with the order: id, `subtotalCents`, `discountCents` (0 for now), `totalCents`, `createdAt`, and lines with `productId`, `productName`, `unitPriceCents`, `quantity`, `lineTotalCents`
- [x] An empty cart returns 422 `EMPTY_CART`; an unknown cart returns 404 `CART_NOT_FOUND`
- [x] Insufficient stock returns 409 `INSUFFICIENT_INVENTORY`, listing every short line with requested and available quantities
- [x] Any failure rolls back everything: the cart stays `OPEN`, and inventory is unchanged
- [x] The orders table has a unique cart id
- [x] `GET /api/orders/{id}` returns the order; an unknown id returns 404 `ORDER_NOT_FOUND`
- [x] The cart view shows `orderId` once the cart is checked out
- [x] Test 1 (oversell race): ten carts, each with one unit of the stock-3 product, check out in parallel; exactly 3 succeed and 7 get `INSUFFICIENT_INVENTORY`; the product shows 0 inventory; the successful orders sum to 3 units
- [x] Test: a failed checkout leaves the cart `OPEN` and inventory unchanged
- [x] OpenAPI document regenerated and committed
- [x] (UI, cuttable) Checkout button on the cart page; an order page showing the snapshot lines and the totals breakdown
- [x] `DECISIONS.md` records the transaction strategy, conditional-update guards with their backing constraints, the Postgres READ COMMITTED portability argument, lock ordering, why the fiber-interleaving race tests are meaningful despite SQLite's single connection, and treating a committed checkout as payment

**Note from 04:** Checking out an already-checked-out cart currently always returns 409 `CART_ALREADY_CHECKED_OUT` with `orderId`; 05 turns a matching request into a 200 replay. The SPA forgets the stored cart id after a successful checkout and navigates to `/orders/$orderId`; a stored cart that turns out to be checked out shows a link to its order.
