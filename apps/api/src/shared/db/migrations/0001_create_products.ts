import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      available_inventory INTEGER NOT NULL CHECK (available_inventory >= 0)
    ) STRICT
  `;
});
