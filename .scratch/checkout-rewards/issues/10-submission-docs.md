# 10: Submission docs

**What to build:** A reviewer can clone the repo, set it up and run it from the README, explore every endpoint and error case, reproduce the retry and conflict behaviour with executable examples, and read a complete `DECISIONS.md` covering every section the assignment requires. See the assignment README (Required Deliverables, Submission) and SPEC.md (Further Notes).

**Blocked by:** 01–09

**Status:** ready-for-agent

- [ ] README covers prerequisites (Node 24, pnpm), install, run, test, reset-db, and environment variables (`n`, `x`, database path)
- [ ] README has an endpoint table with method, path, purpose, success status and error codes, with admin endpoints clearly marked
- [ ] README links to the served interactive docs and to the committed OpenAPI document
- [ ] README states the approximate time spent and anything incomplete, with how it would be finished
- [ ] An executable request-examples file walks through the happy path, a retried checkout (replay), a conflicting checkout, a price change, oversell, coupon generation and redemption, a double redemption, and the report
- [ ] `DECISIONS.md` is final and complete:
  - [ ] invariants, and where each is enforced
  - [ ] ambiguities and the semantics chosen
  - [ ] at least five decisions in the Context / Options considered / Choice / Why / Consequences format
  - [ ] the transaction, concurrency and idempotency strategy
  - [ ] money and rounding rules
  - [ ] the error model
  - [ ] what was implemented versus deferred
  - [ ] multi-instance and Postgres evolution
  - [ ] AI usage, with a concrete example of redirected output (e.g. `expectedTotal` changed to `expectedSubtotalCents`, and the Idempotency-Key header rejected in favour of cart-as-key)
  - [ ] what to examine first given another two hours
- [ ] The commit history reads as meaningful increments
- [ ] CI is green on the final commit
