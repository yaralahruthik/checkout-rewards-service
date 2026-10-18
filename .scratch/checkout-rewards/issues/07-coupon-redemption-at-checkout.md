# 07: Coupon redemption at checkout

**What to build:** A shopper can supply a coupon at checkout and get its discount. A coupon is redeemed at most once, even when two checkouts race for it, and it is never consumed by a checkout that ultimately fails. Discounts are deterministic, rounded down to the cent, and never make a total negative. See SPEC.md (Checkout semantics, step 6; Money).

**Blocked by:** 05 — Checkout replay and price guard; 06 — Coupon generation

**Status:** ready-for-agent

- [ ] Checkout accepts an optional `couponCode`
- [ ] An unknown code returns 422 `COUPON_INVALID`
- [ ] Inside the checkout transaction, the coupon is redeemed with a conditional update that only succeeds while it is unredeemed. If no row changes, the response is 409 `COUPON_ALREADY_REDEEMED`.
- [ ] The discount is floor(subtotal × the coupon's snapshotted percent / 100), clamped so the total is ≥ 0; the order records `discountCents`, `discountPercent` and `couponCode`
- [ ] Any later failure in the transaction rolls back the redemption
- [ ] The replay rule compares the request's coupon code with the original order's (same code → 200 replay; different code → `CART_ALREADY_CHECKED_OUT`)
- [ ] The coupon list shows redeemed coupons with the redeeming order id and timestamp
- [ ] Test 3 (coupon race): two carts check out concurrently with the same coupon. Exactly one succeeds with the discount; the other gets `COUPON_ALREADY_REDEEMED`, its cart is still `OPEN`, and its products' inventory is unchanged.
- [ ] Test 4 (coupon survives a failed checkout): a checkout with a valid coupon fails on insufficient inventory; the coupon is still listed as available, and a later valid checkout redeems it
- [ ] Test 7 (rounding assertion): a 10% coupon on a 1999-cent subtotal gives a 199-cent discount and an 1800-cent total
- [ ] OpenAPI document regenerated and committed
- [ ] (UI, cuttable) A coupon input on the cart page; the order page shows the discount line
- [ ] `DECISIONS.md` records the money and rounding rules, one coupon per order, the whole-subtotal scope, and the ordering of redemption within the transaction
