import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** The order response body, typed for reading fields in assertions. */
type OrderBody = {
  readonly id: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly createdAt: string;
  readonly lines: ReadonlyArray<{ readonly quantity: number }>;
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A new cart holding the given `[productId, quantity]` lines. */
const cartWith = (...lines: ReadonlyArray<readonly [number, number]>) =>
  Effect.gen(function* () {
    const cart = yield* HttpClient.post("/api/carts").pipe(Effect.flatMap((r) => r.json));
    const cartId = (cart as { id: string }).id;
    for (const [productId, quantity] of lines) {
      yield* HttpClient.put(`/api/carts/${cartId}/items/${productId}`, {
        body: HttpBody.jsonUnsafe({ quantity }),
      });
    }
    return cartId;
  });

const checkout = (cartId: string) => HttpClient.post(`/api/carts/${cartId}/checkout`);

const inventoryOf = (productId: number) =>
  HttpClient.get("/api/products").pipe(
    Effect.flatMap((response) => response.json),
    Effect.map(
      (products) =>
        (products as ReadonlyArray<{ id: number; availableInventory: number }>).find(
          (product) => product.id === productId,
        )!.availableInventory,
    ),
  );

it.effect(
  "checking out creates an order whose line snapshots and totals explain what was bought",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([4, 3], [1, 2]);

      const response = yield* checkout(cartId);

      assert.strictEqual(response.status, 201);
      const order = (yield* response.json) as OrderBody;
      assert.match(order.id, UUID_V7);
      assert.isFalse(Number.isNaN(Date.parse(order.createdAt)));
      assert.deepStrictEqual<unknown>(order, {
        id: order.id,
        subtotalCents: 23995,
        discountCents: 0,
        totalCents: 23995,
        createdAt: order.createdAt,
        lines: [
          {
            productId: 1,
            productName: "Mechanical Keyboard",
            unitPriceCents: 8999,
            quantity: 2,
            lineTotalCents: 17998,
          },
          {
            productId: 4,
            productName: "Laptop Stand",
            unitPriceCents: 1999,
            quantity: 3,
            lineTotalCents: 5997,
          },
        ],
      });

      const fetched = yield* HttpClient.get(`/api/orders/${order.id}`);
      assert.strictEqual(fetched.status, 200);
      assert.deepStrictEqual<unknown>(yield* fetched.json, order);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "ten carts racing for the last three units: three orders are placed and seven get INSUFFICIENT_INVENTORY",
  () =>
    Effect.gen(function* () {
      const cartIds = yield* Effect.all(Array.from({ length: 10 }, () => cartWith([6, 1])));

      const responses = yield* Effect.forEach(cartIds, checkout, { concurrency: "unbounded" });

      const placed = responses.filter((response) => response.status === 201);
      const refused = responses.filter((response) => response.status === 409);
      assert.strictEqual(placed.length, 3);
      assert.strictEqual(refused.length, 7);
      for (const response of refused) {
        const error = (yield* response.json) as { code: string };
        assert.strictEqual(error.code, "INSUFFICIENT_INVENTORY");
      }

      const units = yield* Effect.forEach(placed, (response) =>
        response.json.pipe(
          Effect.map((order) =>
            (order as OrderBody).lines.reduce((sum, line) => sum + line.quantity, 0),
          ),
        ),
      );
      assert.strictEqual(
        units.reduce((sum, n) => sum + n, 0),
        3,
      );
      assert.strictEqual(yield* inventoryOf(6), 0);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "a checkout that fails on stock lists every short line and leaves the cart open and inventory unchanged",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([1, 1], [5, 2], [6, 3]);
      yield* HttpClient.patch("/api/admin/products/5", {
        body: HttpBody.jsonUnsafe({ availableInventory: 0 }),
      });
      yield* HttpClient.patch("/api/admin/products/6", {
        body: HttpBody.jsonUnsafe({ availableInventory: 1 }),
      });

      const response = yield* checkout(cartId);

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "INSUFFICIENT_INVENTORY",
        message: "Not enough inventory for 2 products",
        details: {
          lines: [
            { productId: 5, requestedQuantity: 2, availableInventory: 0 },
            { productId: 6, requestedQuantity: 3, availableInventory: 1 },
          ],
        },
      });
      const cart = (yield* HttpClient.get(`/api/carts/${cartId}`).pipe(
        Effect.flatMap((r) => r.json),
      )) as { status: string; itemCount: number };
      assert.strictEqual(cart.status, "OPEN");
      assert.strictEqual(cart.itemCount, 6);
      assert.strictEqual(yield* inventoryOf(1), 25);
      assert.strictEqual(yield* inventoryOf(5), 0);
      assert.strictEqual(yield* inventoryOf(6), 1);

      yield* HttpClient.del(`/api/carts/${cartId}/items/5`);
      yield* HttpClient.put(`/api/carts/${cartId}/items/6`, {
        body: HttpBody.jsonUnsafe({ quantity: 1 }),
      });
      assert.strictEqual((yield* checkout(cartId)).status, 201);
      assert.strictEqual(yield* inventoryOf(1), 24);
      assert.strictEqual(yield* inventoryOf(6), 0);
    }).pipe(Effect.provide(TestApi)),
);

it.effect("checking out an empty cart returns EMPTY_CART and leaves the cart open", () =>
  Effect.gen(function* () {
    const cartId = yield* cartWith();

    const response = yield* checkout(cartId);

    assert.strictEqual(response.status, 422);
    assert.deepStrictEqual<unknown>(yield* response.json, {
      code: "EMPTY_CART",
      message: `Cart ${cartId} is empty`,
      details: { cartId },
    });
    yield* HttpClient.put(`/api/carts/${cartId}/items/2`, {
      body: HttpBody.jsonUnsafe({ quantity: 1 }),
    });
    assert.strictEqual((yield* checkout(cartId)).status, 201);
  }).pipe(Effect.provide(TestApi)),
);

it.effect("checking out a cart that does not exist returns CART_NOT_FOUND", () =>
  Effect.gen(function* () {
    const missing = "01900000-0000-7000-8000-000000000000";

    const response = yield* checkout(missing);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual<unknown>(yield* response.json, {
      code: "CART_NOT_FOUND",
      message: `Cart ${missing} does not exist`,
      details: { cartId: missing },
    });
  }).pipe(Effect.provide(TestApi)),
);

it.effect("an order that does not exist returns ORDER_NOT_FOUND", () =>
  Effect.gen(function* () {
    const missing = "01900000-0000-7000-8000-000000000000";

    const response = yield* HttpClient.get(`/api/orders/${missing}`);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual<unknown>(yield* response.json, {
      code: "ORDER_NOT_FOUND",
      message: `Order ${missing} does not exist`,
      details: { orderId: missing },
    });
  }).pipe(Effect.provide(TestApi)),
);

it.effect("a checked-out cart shows its status and the id of the order it produced", () =>
  Effect.gen(function* () {
    const cartId = yield* cartWith([3, 1]);

    const order = (yield* checkout(cartId).pipe(Effect.flatMap((r) => r.json))) as OrderBody;

    const cart = (yield* HttpClient.get(`/api/carts/${cartId}`).pipe(
      Effect.flatMap((r) => r.json),
    )) as { status: string; orderId: string };
    assert.strictEqual(cart.status, "CHECKED_OUT");
    assert.strictEqual(cart.orderId, order.id);
  }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "checking out a cart again returns CART_ALREADY_CHECKED_OUT with the original order and takes no more stock",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([6, 2]);
      const order = (yield* checkout(cartId).pipe(Effect.flatMap((r) => r.json))) as OrderBody;

      const response = yield* checkout(cartId);

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "CART_ALREADY_CHECKED_OUT",
        message: `Cart ${cartId} is already checked out`,
        details: { cartId, orderId: order.id },
      });
      assert.strictEqual(yield* inventoryOf(6), 1);
    }).pipe(Effect.provide(TestApi)),
);
