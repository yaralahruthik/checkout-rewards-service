# 08: Admin report and order list

**What to build:** An administrator can list all orders and view a summary report: quantity purchased per product, gross revenue, discounts, net revenue, coupon counts, and total orders. The report reconciles exactly with the orders and coupons the API returns, and viewing it never changes state. See SPEC.md (Reporting semantics).

**Blocked by:** 07 — Coupon redemption at checkout

**Status:** ready-for-agent

- [ ] `GET /api/admin/orders` lists all orders, newest first, with their lines (no pagination)
- [ ] `GET /api/admin/report` is computed on read, with no stored counters, and returns:
  - [ ] per-product purchased quantity, from the line snapshots
  - [ ] `grossRevenueCents` = sum of subtotals
  - [ ] `totalDiscountsCents` = sum of discounts
  - [ ] `netRevenueCents` = sum of totals
  - [ ] coupons generated, available and redeemed
  - [ ] total successful orders
- [ ] The report performs no writes
- [ ] Test 6 (reconciliation): after a mixed scenario (discounted and undiscounted orders, plus some failed checkouts), every report figure equals the corresponding sum over the listed orders and coupons; gross − discounts = net; two consecutive report requests return identical bodies, and the listed orders and coupons are unchanged
- [ ] OpenAPI document regenerated and committed
- [ ] (UI, cuttable) Admin report panel and orders panel
- [ ] `DECISIONS.md` records computing on read versus keeping counters, and deferred pagination
