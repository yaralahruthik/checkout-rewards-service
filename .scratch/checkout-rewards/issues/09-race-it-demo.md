# 09: "Race it" demo

**What to build:** From the SPA admin page, an evaluator can press one button to watch the no-oversell guarantee hold live. The button resets the limited-stock product to a small inventory, fires many parallel checkouts from fresh carts, and shows how many succeeded versus were rejected, alongside the resulting inventory. This is a demonstration, not a test. See SPEC.md (Frontend).

**Blocked by:** 02 — Admin product updates; 04 — Checkout and order snapshots

**Status:** ready-for-agent

- [ ] The admin page has a "race it" control with a configurable number of parallel checkouts (default 10) and a starting stock (default 3)
- [ ] It sets the limited product's inventory through the admin product update, creates N carts each holding one unit, and fires all N checkouts concurrently through the generated client
- [ ] It shows the tally: successes, `INSUFFICIENT_INVENTORY` rejections, any other errors, and the product's final inventory, which must equal starting stock minus successes and never go below zero
- [ ] Uses only public and admin API endpoints; no backend changes are needed
- [ ] README mentions the demo and how to use it
