import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

it.effect("lists every seeded product with its price in integer cents and available stock", () =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get("/api/products");

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(yield* response.json, [
      { id: 1, name: "Mechanical Keyboard", unitPriceCents: 8999, availableInventory: 25 },
      { id: 2, name: "Wireless Mouse", unitPriceCents: 2499, availableInventory: 40 },
      { id: 3, name: "USB-C Hub", unitPriceCents: 3499, availableInventory: 30 },
      { id: 4, name: "Laptop Stand", unitPriceCents: 1999, availableInventory: 20 },
      { id: 5, name: "Noise-Cancelling Headphones", unitPriceCents: 14999, availableInventory: 15 },
      { id: 6, name: "Limited Edition Keycap Set", unitPriceCents: 4999, availableInventory: 3 },
    ]);
  }).pipe(Effect.provide(TestApi)),
);
