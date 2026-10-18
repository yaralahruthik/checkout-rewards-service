import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** The product with the given id, as `GET /api/products` returns it. */
const catalogProduct = (id: number) =>
  HttpClient.get("/api/products").pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((products): unknown =>
      (products as ReadonlyArray<{ id: number }>).find((p) => p.id === id),
    ),
  );

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

it.effect(
  "an administrator sets a product's price and inventory, and the catalog shows the change",
  () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.patch("/api/admin/products/6", {
        body: HttpBody.jsonUnsafe({ unitPriceCents: 5499, availableInventory: 0 }),
      });

      assert.strictEqual(response.status, 200);
      const updated = {
        id: 6,
        name: "Limited Edition Keycap Set",
        unitPriceCents: 5499,
        availableInventory: 0,
      };
      assert.deepStrictEqual(yield* response.json, updated);
      assert.deepStrictEqual(yield* catalogProduct(6), updated);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "a product update with a negative, fractional, non-numeric or missing value is rejected and changes nothing",
  () =>
    Effect.gen(function* () {
      const invalidBodies = [
        { unitPriceCents: -1 },
        { availableInventory: 2.5 },
        { unitPriceCents: "1999" },
        { unitPriceCents: 1999, availableInventory: -3 },
        {},
      ];

      for (const body of invalidBodies) {
        const response = yield* HttpClient.patch("/api/admin/products/1", {
          body: HttpBody.jsonUnsafe(body),
        });
        assert.strictEqual(response.status, 400, JSON.stringify(body));
        const error = (yield* response.json) as { code: string; details: { location: string } };
        assert.strictEqual(error.code, "VALIDATION_ERROR");
        assert.strictEqual(error.details.location, "body");
      }
      assert.deepStrictEqual(yield* catalogProduct(1), {
        id: 1,
        name: "Mechanical Keyboard",
        unitPriceCents: 8999,
        availableInventory: 25,
      });
    }).pipe(Effect.provide(TestApi)),
);

it.effect("updating a product that does not exist returns PRODUCT_NOT_FOUND", () =>
  Effect.gen(function* () {
    const response = yield* HttpClient.patch("/api/admin/products/999", {
      body: HttpBody.jsonUnsafe({ unitPriceCents: 100 }),
    });

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(yield* response.json, {
      code: "PRODUCT_NOT_FOUND",
      message: "Product 999 does not exist",
      details: { productId: 999 },
    });
  }).pipe(Effect.provide(TestApi)),
);
