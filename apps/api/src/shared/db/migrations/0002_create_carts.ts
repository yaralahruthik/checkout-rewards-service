import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE carts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'CHECKED_OUT')),
      created_at TEXT NOT NULL
    ) STRICT
  `;
  // No price column: a line's price is always read live from products.
  yield* sql`
    CREATE TABLE cart_lines (
      cart_id TEXT NOT NULL REFERENCES carts (id),
      product_id INTEGER NOT NULL REFERENCES products (id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      PRIMARY KEY (cart_id, product_id)
    ) STRICT
  `;
});
