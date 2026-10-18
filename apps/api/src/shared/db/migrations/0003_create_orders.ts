import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The unique cart id backs the conditional cart claim: one order per cart.
  yield* sql`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL UNIQUE REFERENCES carts (id),
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
      discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TEXT NOT NULL,
      CHECK (total_cents = subtotal_cents - discount_cents)
    ) STRICT
  `;
  // Snapshots: copied at checkout and never joined to products when read.
  yield* sql`
    CREATE TABLE order_lines (
      order_id TEXT NOT NULL REFERENCES orders (id),
      product_id INTEGER NOT NULL REFERENCES products (id),
      product_name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents = unit_price_cents * quantity),
      PRIMARY KEY (order_id, product_id)
    ) STRICT
  `;
});
