import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** The cart response body, typed for reading fields in assertions. */
type CartBody = {
  readonly id: string;
  readonly status: string;
  readonly itemCount: number;
  readonly subtotalCents: number;
  readonly lines: ReadonlyArray<unknown>;
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const newCartId = HttpClient.post("/api/carts").pipe(
  Effect.flatMap((response) => response.json),
  Effect.map((cart) => (cart as CartBody).id),
);

const getCart = (cartId: string) =>
  HttpClient.get(`/api/carts/${cartId}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.map((cart) => cart as CartBody),
  );

/** `quantity` is `unknown` so tests can send invalid values. */
const setQuantity = (cartId: string, productId: number | string, quantity: unknown) =>
  HttpClient.put(`/api/carts/${cartId}/items/${productId}`, {
    body: HttpBody.jsonUnsafe({ quantity }),
  });

it.effect("creating a cart returns an empty open cart identified by a UUIDv7", () =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post("/api/carts");

    assert.strictEqual(response.status, 201);
    const cart = (yield* response.json) as CartBody;
    assert.match(cart.id, UUID_V7);
    assert.deepStrictEqual(cart, {
      id: cart.id,
      status: "OPEN",
      itemCount: 0,
      subtotalCents: 0,
      lines: [],
    });

    const fetched = yield* HttpClient.get(`/api/carts/${cart.id}`);
    assert.strictEqual(fetched.status, 200);
    assert.deepStrictEqual<unknown>(yield* fetched.json, cart);
  }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "setting quantities adds lines priced at current prices, with line totals and a subtotal",
  () =>
    Effect.gen(function* () {
      const cartId = yield* newCartId;

      yield* setQuantity(cartId, 4, 3);
      const response = yield* setQuantity(cartId, 1, 2);

      assert.strictEqual(response.status, 200);
      const expected = {
        id: cartId,
        status: "OPEN",
        itemCount: 5,
        subtotalCents: 23995,
        lines: [
          {
            productId: 1,
            productName: "Mechanical Keyboard",
            quantity: 2,
            unitPriceCents: 8999,
            lineTotalCents: 17998,
            availableInventory: 25,
            insufficientStock: false,
          },
          {
            productId: 4,
            productName: "Laptop Stand",
            quantity: 3,
            unitPriceCents: 1999,
            lineTotalCents: 5997,
            availableInventory: 20,
            insufficientStock: false,
          },
        ],
      };
      assert.deepStrictEqual<unknown>(yield* response.json, expected);
      assert.deepStrictEqual<unknown>(yield* getCart(cartId), expected);
    }).pipe(Effect.provide(TestApi)),
);

it.effect("setting a quantity replaces it: repeating a request never adds to the line", () =>
  Effect.gen(function* () {
    const cartId = yield* newCartId;

    yield* setQuantity(cartId, 2, 3);
    yield* setQuantity(cartId, 2, 3);
    assert.strictEqual((yield* getCart(cartId)).itemCount, 3);

    yield* setQuantity(cartId, 2, 1);
    const cart = yield* getCart(cartId);
    assert.strictEqual(cart.itemCount, 1);
    assert.strictEqual(cart.subtotalCents, 2499);
    assert.strictEqual(cart.lines.length, 1);
  }).pipe(Effect.provide(TestApi)),
);

it.effect("removing an item deletes its line, and removing it again changes nothing", () =>
  Effect.gen(function* () {
    const cartId = yield* newCartId;
    yield* setQuantity(cartId, 1, 1);
    yield* setQuantity(cartId, 3, 2);

    const removeKeyboard = HttpClient.del(`/api/carts/${cartId}/items/1`);
    const response = yield* removeKeyboard;

    assert.strictEqual(response.status, 200);
    const cart = (yield* response.json) as CartBody;
    assert.deepStrictEqual(
      cart.lines.map((line) => (line as { productId: number }).productId),
      [3],
    );
    assert.strictEqual(cart.subtotalCents, 6998);
    assert.deepStrictEqual<unknown>(yield* getCart(cartId), cart);

    const again = yield* removeKeyboard;
    assert.strictEqual(again.status, 200);
    assert.deepStrictEqual<unknown>(yield* again.json, cart);
  }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "a quantity that is not an integer from 1 to 99 is rejected and never enters the cart",
  () =>
    Effect.gen(function* () {
      const cartId = yield* newCartId;
      yield* setQuantity(cartId, 1, 2);

      for (const quantity of [0, -1, 1.5, 100, "2", null]) {
        const response = yield* setQuantity(cartId, 1, quantity);
        assert.strictEqual(response.status, 400, JSON.stringify(quantity));
        const error = (yield* response.json) as { code: string; details: { location: string } };
        assert.strictEqual(error.code, "VALIDATION_ERROR");
        assert.strictEqual(error.details.location, "body");
      }

      const cart = yield* getCart(cartId);
      assert.strictEqual(cart.itemCount, 2);
      assert.strictEqual(cart.lines.length, 1);
    }).pipe(Effect.provide(TestApi)),
);

it.effect("an unknown product returns PRODUCT_NOT_FOUND and never enters the cart", () =>
  Effect.gen(function* () {
    const cartId = yield* newCartId;

    const response = yield* setQuantity(cartId, 999, 1);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual<unknown>(yield* response.json, {
      code: "PRODUCT_NOT_FOUND",
      message: "Product 999 does not exist",
      details: { productId: 999 },
    });
    assert.deepStrictEqual((yield* getCart(cartId)).lines, []);
  }).pipe(Effect.provide(TestApi)),
);

it.effect("every cart endpoint returns CART_NOT_FOUND for a cart that does not exist", () =>
  Effect.gen(function* () {
    const missing = "01900000-0000-7000-8000-000000000000";

    const responses = [
      yield* HttpClient.get(`/api/carts/${missing}`),
      yield* setQuantity(missing, 1, 1),
      yield* HttpClient.del(`/api/carts/${missing}/items/1`),
    ];

    for (const response of responses) {
      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "CART_NOT_FOUND",
        message: `Cart ${missing} does not exist`,
        details: { cartId: missing },
      });
    }
  }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "a quantity above the product's current inventory returns INSUFFICIENT_INVENTORY and leaves the line unchanged",
  () =>
    Effect.gen(function* () {
      const cartId = yield* newCartId;
      yield* setQuantity(cartId, 6, 2);

      const response = yield* setQuantity(cartId, 6, 4);

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual<unknown>(yield* response.json, {
        code: "INSUFFICIENT_INVENTORY",
        message: "Not enough inventory for 1 product",
        details: { lines: [{ productId: 6, requestedQuantity: 4, availableInventory: 3 }] },
      });
      assert.strictEqual((yield* getCart(cartId)).itemCount, 2);

      assert.strictEqual((yield* setQuantity(cartId, 6, 3)).status, 200);
    }).pipe(Effect.provide(TestApi)),
);

it.effect(
  "the cart shows the current price and flags a line whose quantity now exceeds stock",
  () =>
    Effect.gen(function* () {
      const cartId = yield* newCartId;
      yield* setQuantity(cartId, 6, 3);
      yield* setQuantity(cartId, 2, 1);

      yield* HttpClient.patch("/api/admin/products/6", {
        body: HttpBody.jsonUnsafe({ unitPriceCents: 5499, availableInventory: 1 }),
      });

      const cart = yield* getCart(cartId);
      assert.strictEqual(cart.subtotalCents, 18996);
      assert.deepStrictEqual<unknown>(cart.lines, [
        {
          productId: 2,
          productName: "Wireless Mouse",
          quantity: 1,
          unitPriceCents: 2499,
          lineTotalCents: 2499,
          availableInventory: 40,
          insufficientStock: false,
        },
        {
          productId: 6,
          productName: "Limited Edition Keycap Set",
          quantity: 3,
          unitPriceCents: 5499,
          lineTotalCents: 16497,
          availableInventory: 1,
          insufficientStock: true,
        },
      ]);
    }).pipe(Effect.provide(TestApi)),
);
