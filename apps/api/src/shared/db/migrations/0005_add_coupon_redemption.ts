import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Checkout redeems the coupon before it inserts the order, so the coupon's
  // reference to the order is checked at commit. SQLite cannot alter a
  // constraint, so the table is rebuilt. Nothing references coupons yet.
  yield* sql`
    CREATE TABLE coupons_new (
      code TEXT PRIMARY KEY,
      milestone_order_count INTEGER NOT NULL UNIQUE CHECK (milestone_order_count >= 1),
      discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
      created_at TEXT NOT NULL,
      redeemed_order_id TEXT UNIQUE REFERENCES orders (id) DEFERRABLE INITIALLY DEFERRED,
      redeemed_at TEXT,
      CHECK ((redeemed_order_id IS NULL) = (redeemed_at IS NULL))
    ) STRICT
  `;
  yield* sql`INSERT INTO coupons_new SELECT * FROM coupons`;
  yield* sql`DROP TABLE coupons`;
  yield* sql`ALTER TABLE coupons_new RENAME TO coupons`;
  yield* sql`ALTER TABLE orders ADD COLUMN coupon_code TEXT REFERENCES coupons (code)`;
  // The percent is copied from the coupon, so an order has both or neither.
  yield* sql`
    ALTER TABLE orders ADD COLUMN discount_percent INTEGER
      CHECK (discount_percent BETWEEN 1 AND 100)
      CHECK ((coupon_code IS NULL) = (discount_percent IS NULL))
  `;
  // Backs the conditional redemption: a coupon discounts at most one order.
  // ADD COLUMN cannot declare UNIQUE, so it is an index.
  yield* sql`CREATE UNIQUE INDEX orders_coupon_code ON orders (coupon_code)`;
});
