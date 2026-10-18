import { assert } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";

/**
 * Shopper steps through the HTTP API, shared by the feature tests. Each needs
 * the `HttpClient` that `TestApi` provides.
 */

/** A new cart holding the given `[productId, quantity]` lines. */
export const cartWith = (...lines: ReadonlyArray<readonly [number, number]>) =>
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

/** Checks out the cart. With no `request`, the checkout is sent without a body. */
export const checkout = (
  cartId: string,
  request?: { readonly couponCode?: string; readonly expectedSubtotalCents?: number },
) =>
  HttpClient.post(
    `/api/carts/${cartId}/checkout`,
    request === undefined ? {} : { body: HttpBody.jsonUnsafe(request) },
  );

/** Checks out a new cart holding the lines, asserts the order was created, and returns it. */
export const placeOrder = (...lines: ReadonlyArray<readonly [number, number]>) =>
  Effect.gen(function* () {
    const response = yield* checkout(yield* cartWith(...lines));
    assert.strictEqual(response.status, 201);
    return yield* response.json;
  });
