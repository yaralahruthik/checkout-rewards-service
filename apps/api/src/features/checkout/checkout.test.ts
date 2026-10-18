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

const checkout = (
  cartId: string,
  request?: { readonly couponCode?: string; readonly expectedSubtotalCents?: number },
) =>
  HttpClient.post(
    `/api/carts/${cartId}/checkout`,
    request === undefined ? {} : { body: HttpBody.jsonUnsafe(request) },
  );

/** The cart view, typed for reading fields in assertions. */
const cartOf = (cartId: string) =>
  HttpClient.get(`/api/carts/${cartId}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((cart) => cart as { status: string; itemCount: number; orderId?: string }),
  );

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

      const responses = yield* Effect.forEach(cartIds, (cartId) => checkout(cartId), {
        concurrency: "unbounded",
      });

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
      const cart = yield* cartOf(cartId);
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

    const cart = yield* cartOf(cartId);
    assert.strictEqual(cart.status, "CHECKED_OUT");
    assert.strictEqual(cart.orderId, order.id);
  }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "checking out a cart again replays the original order with 200 and takes no more stock",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([6, 2]);
      const order = (yield* checkout(cartId).pipe(Effect.flatMap((r) => r.json))) as OrderBody;

      const response = yield* checkout(cartId);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual<unknown>(yield* response.json, order);
      assert.strictEqual(yield* inventoryOf(6), 1);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "checking out a checked-out cart with a different coupon code returns CART_ALREADY_CHECKED_OUT",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([3, 1]);
      const order = (yield* checkout(cartId).pipe(Effect.flatMap((r) => r.json))) as OrderBody;

      const response = yield* checkout(cartId, { couponCode: "SAVE10-ABCD" });

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "CART_ALREADY_CHECKED_OUT",
        message: `Cart ${cartId} is already checked out`,
        details: { cartId, orderId: order.id },
      });
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "checking out with an unknown coupon code returns COUPON_INVALID and leaves the cart open",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([6, 1]);

      const response = yield* checkout(cartId, { couponCode: "NOPE" });

      assert.strictEqual(response.status, 422);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "COUPON_INVALID",
        message: "Coupon NOPE does not exist",
        details: { couponCode: "NOPE" },
      });
      const cart = yield* cartOf(cartId);
      assert.strictEqual(cart.status, "OPEN");
      assert.strictEqual(yield* inventoryOf(6), 3);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "ten concurrent checkouts of one cart place one order: one 201, nine 200 replays, stock taken once",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([6, 2]);

      const responses = yield* Effect.forEach(Array.from({ length: 10 }), () => checkout(cartId), {
        concurrency: "unbounded",
      });

      assert.deepStrictEqual(
        responses.map((response) => response.status).sort((a, b) => a - b),
        [200, 200, 200, 200, 200, 200, 200, 200, 200, 201],
      );
      const orders = yield* Effect.forEach(responses, (response) =>
        response.json.pipe(Effect.map((order) => order as unknown as OrderBody)),
      );
      const orderIds = new Set(orders.map((order) => order.id));
      assert.strictEqual(orderIds.size, 1);
      const [orderId] = orderIds;
      const cart = yield* cartOf(cartId);
      assert.strictEqual(cart.orderId, orderId);
      assert.strictEqual(yield* inventoryOf(6), 1);

      const conflict = yield* checkout(cartId, { couponCode: "SAVE10-ABCD" });
      assert.strictEqual(conflict.status, 409);
      const error = (yield* conflict.json) as { code: string; details: { orderId: string } };
      assert.strictEqual(error.code, "CART_ALREADY_CHECKED_OUT");
      assert.strictEqual(error.details.orderId, orderId);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "a price rise after add-to-cart refuses a stale expected subtotal with PRICE_CHANGED, and the placed order keeps its snapshot",
  () =>
    Effect.gen(function* () {
      const cartId = yield* cartWith([4, 2]);
      const setPrice = (unitPriceCents: number) =>
        HttpClient.patch("/api/admin/products/4", {
          body: HttpBody.jsonUnsafe({ unitPriceCents }),
        });
      yield* setPrice(2499);

      const stale = yield* checkout(cartId, { expectedSubtotalCents: 3998 });

      assert.strictEqual(stale.status, 409);
      assert.deepStrictEqual<unknown>(yield* stale.json, {
        code: "PRICE_CHANGED",
        message: "The subtotal is now 4998 cents, not 3998",
        details: {
          expectedSubtotalCents: 3998,
          subtotalCents: 4998,
          lines: [
            {
              productId: 4,
              productName: "Laptop Stand",
              unitPriceCents: 2499,
              quantity: 2,
              lineTotalCents: 4998,
            },
          ],
        },
      });
      const cart = yield* cartOf(cartId);
      assert.strictEqual(cart.status, "OPEN");
      assert.strictEqual(yield* inventoryOf(4), 20);

      const placed = yield* checkout(cartId, { expectedSubtotalCents: 4998 });
      assert.strictEqual(placed.status, 201);
      const order = (yield* placed.json) as OrderBody;
      assert.strictEqual(order.subtotalCents, 4998);

      yield* setPrice(999);
      const fetched = yield* HttpClient.get(`/api/orders/${order.id}`).pipe(
        Effect.flatMap((r) => r.json),
      );
      assert.deepStrictEqual<unknown>(fetched, order);

      const replay = yield* checkout(cartId, { expectedSubtotalCents: 1 });
      assert.strictEqual(replay.status, 200);
      assert.deepStrictEqual<unknown>(yield* replay.json, order);
    }).pipe(Effect.provide(TestApi)),
);
