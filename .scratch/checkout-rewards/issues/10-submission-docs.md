# 10: Submission docs

**What to build:** A reviewer can clone the repo, set it up and run it from the README, explore every endpoint and error case, reproduce the retry and conflict behaviour with executable examples, and read a complete `DECISIONS.md` covering every section the assignment requires. See the assignment brief, `BRIEF.md` (Required Deliverables, Submission) and SPEC.md (Further Notes).

**Blocked by:** 01–09

**Status:** done (CI pending push)

- [x] README covers prerequisites (Node 24, pnpm), install, run, test, reset-db, and environment variables (`n`, `x`, database path)
- [x] README has an endpoint table with method, path, purpose, success status and error codes, with admin endpoints clearly marked
- [x] README links to the served interactive docs and to the committed OpenAPI document
- [x] README states the approximate time spent and anything incomplete, with how it would be finished
- [x] An executable request-examples file walks through the happy path, a retried checkout (replay), a conflicting checkout, a price change, oversell, coupon generation and redemption, a double redemption, and the report
- [x] `DECISIONS.md` is final and complete:
  - [x] invariants, and where each is enforced
  - [x] ambiguities and the semantics chosen
  - [x] at least five decisions in the Context / Options considered / Choice / Why / Consequences format
  - [x] the transaction, concurrency and idempotency strategy
  - [x] money and rounding rules
  - [x] the error model
  - [x] what was implemented versus deferred
  - [x] multi-instance and Postgres evolution
  - [x] AI usage, with a concrete example of redirected output (e.g. `expectedTotal` changed to `expectedSubtotalCents`, and the Idempotency-Key header rejected in favour of cart-as-key)
  - [x] what to examine first given another two hours
- [x] The commit history reads as meaningful increments
- [ ] CI is green on the final commit
