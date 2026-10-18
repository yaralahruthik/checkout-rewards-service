import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The unique milestone backs generation: one coupon per milestone, however
  // many requests race for it. The percent is a snapshot of the config.
  yield* sql`
    CREATE TABLE coupons (
      code TEXT PRIMARY KEY,
      milestone_order_count INTEGER NOT NULL UNIQUE CHECK (milestone_order_count >= 1),
      discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
      created_at TEXT NOT NULL,
      redeemed_order_id TEXT UNIQUE REFERENCES orders (id),
      redeemed_at TEXT,
      CHECK ((redeemed_order_id IS NULL) = (redeemed_at IS NULL))
    ) STRICT
  `;
});
