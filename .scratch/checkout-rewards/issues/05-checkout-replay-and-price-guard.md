# 05: Checkout replay and price guard

**What to build:** A retried checkout (for example after a timeout) returns the original order instead of creating a second order or charging inventory twice. A shopper is never charged a subtotal they did not see: if prices changed, checkout is refused with the new totals so the shopper can confirm. The SPA demonstrates both. See SPEC.md (Checkout semantics, steps 1 and 4).

**Blocked by:** 02 — Admin product updates; 04 — Checkout and order snapshots

**Status:** ready-for-agent

- [ ] When the cart claim affects no row because the cart is already `CHECKED_OUT`, and the request matches the original (same coupon code, which is absent for now), the response is 200 with the existing order
- [ ] A checkout of an already-checked-out cart with a different request returns 409 `CART_ALREADY_CHECKED_OUT`, with `orderId` in `details`
- [ ] Mutating a checked-out cart (set quantity or remove) returns 409 `CART_NOT_OPEN`
- [ ] Checkout accepts an optional `expectedSubtotalCents`. When it differs from the computed subtotal, the response is 409 `PRICE_CHANGED`, with the new line prices and subtotal in `details`, and the cart stays `OPEN`. The field is ignored on replay.
- [ ] Test 2 (retry storm): the same cart is checked out ten times concurrently. Exactly one order exists; all success responses carry the same order id (one 201, the rest 200); inventory is decremented once. A later checkout with a different coupon code gets `CART_ALREADY_CHECKED_OUT`.
- [ ] Test 7 (price change and snapshot): after add-to-cart, an admin raises the price; checkout with the stale expected subtotal gets `PRICE_CHANGED` and the cart stays open; checkout with the new subtotal succeeds; a later price change does not alter the retrieved order's snapshot
- [ ] OpenAPI document regenerated and committed
- [ ] (UI, cuttable) Checkout always sends the displayed subtotal; on `PRICE_CHANGED`, a dialog shows the new totals and confirming resends; TanStack Query auto-retry is disabled for checkout; a manual "retry checkout" action shows the same order coming back
- [ ] `DECISIONS.md` records the cart as the natural idempotency key, the replay-vs-conflict rule, when an `Idempotency-Key` header would become necessary, and why the subtotal (not the total) is guarded

**Note from 03:** `CartService.setQuantity`/`removeItem` currently read the cart, then write in a separate statement. Enforce `CART_NOT_OPEN` by making the line write conditional on `carts.status = 'OPEN'` (in the same statement), not by checking the status from that read, or a checkout can land between check and write. The SPA also only forgets a stored cart id on `CART_NOT_FOUND`; after checkout it should start a new cart.
