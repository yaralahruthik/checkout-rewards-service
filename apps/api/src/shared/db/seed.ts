import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Six products, inserted only when the catalog is empty, so running the seed
 * again (every startup) never duplicates or overwrites anything.
 *
 * - "Laptop Stand" costs 1999 cents: a 10% discount is 199.9 cents, which
 *   exercises the rounding rule.
 * - "Limited Edition Keycap Set" has stock 3: the oversell demo product.
 */
export const seedProducts = [
  { id: 1, name: "Mechanical Keyboard", unitPriceCents: 8999, availableInventory: 25 },
  { id: 2, name: "Wireless Mouse", unitPriceCents: 2499, availableInventory: 40 },
  { id: 3, name: "USB-C Hub", unitPriceCents: 3499, availableInventory: 30 },
  { id: 4, name: "Laptop Stand", unitPriceCents: 1999, availableInventory: 20 },
  { id: 5, name: "Noise-Cancelling Headphones", unitPriceCents: 14999, availableInventory: 15 },
  { id: 6, name: "Limited Edition Keycap Set", unitPriceCents: 4999, availableInventory: 3 },
] as const;

export const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const existing = yield* sql`SELECT 1 FROM products LIMIT 1`;
      if (existing.length > 0) return;
      yield* sql`INSERT INTO products ${sql.insert(seedProducts)}`;
    }),
  );
});
