import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** Places an order from a new cart holding the given `[productId, quantity]` lines. */
const placeOrder = (...lines: ReadonlyArray<readonly [number, number]>) =>
  Effect.gen(function* () {
    const cart = yield* HttpClient.post("/api/carts").pipe(Effect.flatMap((r) => r.json));
    const cartId = (cart as { id: string }).id;
    for (const [productId, quantity] of lines) {
      yield* HttpClient.put(`/api/carts/${cartId}/items/${productId}`, {
        body: HttpBody.jsonUnsafe({ quantity }),
      });
    }
    const response = yield* HttpClient.post(`/api/carts/${cartId}/checkout`);
    assert.strictEqual(response.status, 201);
    return yield* response.json;
  });

const listOrders = HttpClient.get("/api/admin/orders");

it.effect("with no orders placed, the order list is empty", () =>
  Effect.gen(function* () {
    const response = yield* listOrders;

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual<unknown>(yield* response.json, []);
  }).pipe(Effect.provide(TestApi)),
);

it.effect("the order list holds every order with its lines, newest first", () =>
  Effect.gen(function* () {
    const first = yield* placeOrder([1, 1]);
    const second = yield* placeOrder([4, 3], [2, 1]);
    const third = yield* placeOrder([3, 2]);

    const response = yield* listOrders;

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual<unknown>(yield* response.json, [third, second, first]);
    assert.deepStrictEqual<unknown>(
      (second as { lines: ReadonlyArray<{ productId: number }> }).lines.map((l) => l.productId),
      [2, 4],
    );
  }).pipe(Effect.provide(TestApi)),
);
