# 06: Coupon generation

**What to build:** Once the configured order milestone is reached, an administrator can generate exactly one coupon for it. Repeated or concurrent generation requests never over-issue. Administrators can list coupons with their status. See SPEC.md (Coupon generation semantics).

**Blocked by:** 04 — Checkout and order snapshots

**Status:** done

- [x] `POST /api/admin/coupons/generate` issues one coupon for the oldest unrewarded milestone. The next milestone is (coupons generated + 1) × n, and generation is eligible when `COUNT(orders)` has reached it. Every successful order counts.
- [x] If no milestone is eligible, the response is 409 `NO_ELIGIBLE_MILESTONE`, including the current order count and the next milestone in `details`
- [x] A coupon stores its code (`SAVE<x>-` plus 8 Crockford base32 characters from cryptographic randomness), its milestone order count, its discount percent snapshotted from config, and a created timestamp
- [x] Unique constraints on the code and on the milestone order count
- [x] Skipped milestones are issued oldest-first, one per request
- [x] `GET /api/admin/coupons` lists every coupon with its status (available or redeemed); the redemption fields are null for now
- [x] Test 5 (generation race): at exactly one eligible milestone, five concurrent generate requests produce exactly one coupon, and the others get `NO_ELIGIBLE_MILESTONE`; a further request before the next milestone is also refused
- [x] Test: with two milestones skipped, two requests issue the coupons for milestone n and then 2n
- [x] OpenAPI document regenerated and committed
- [x] (UI, cuttable) Admin coupons panel: a generate button showing the result or error, and the coupon list
- [x] `DECISIONS.md` records lazy generation, counting by `COUNT(orders)` rather than sequence ids, the per-coupon percent snapshot, bearer coupons without expiry, and what happens if n changes
