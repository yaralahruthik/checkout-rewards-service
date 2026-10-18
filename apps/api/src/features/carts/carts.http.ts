import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { CartService } from "./CartService.ts";

const CartsGroup = HttpApiBuilder.group(
  Api,
  "carts",
  Effect.fn("CartsHandlers")(function* (handlers) {
    const carts = yield* CartService;
    return handlers
      .handle("createCart", () => carts.create)
      .handle("getCart", ({ params }) => carts.get(params.id))
      .handle("setItemQuantity", ({ params, payload }) =>
        carts.setQuantity(params.id, params.productId, payload),
      )
      .handle("removeItem", ({ params }) => carts.removeItem(params.id, params.productId));
  }),
);

export const CartsHandlers = CartsGroup.pipe(Layer.provide(CartService.layer));
