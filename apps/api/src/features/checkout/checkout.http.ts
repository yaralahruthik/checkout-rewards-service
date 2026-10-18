import { Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Order } from "../orders/OrdersApi.ts";
import { Api } from "../../Api.ts";
import { CheckoutService } from "./CheckoutService.ts";

const CheckoutGroup = HttpApiBuilder.group(
  Api,
  "checkout",
  Effect.fn("CheckoutHandlers")(function* (handlers) {
    const checkout = yield* CheckoutService;
    const replayResponse = HttpServerResponse.schemaJson(Order);
    return handlers.handle("checkout", ({ params, payload }) =>
      checkout.checkout(params.id, payload ?? {}).pipe(
        // The first success schema (201) encodes every order, so a replay
        // builds its 200 response itself.
        Effect.flatMap(
          ({ order, replayed }): Effect.Effect<Order | HttpServerResponse.HttpServerResponse> =>
            replayed ? Effect.orDie(replayResponse(order, { status: 200 })) : Effect.succeed(order),
        ),
      ),
    );
  }),
);

export const CheckoutHandlers = CheckoutGroup.pipe(Layer.provide(CheckoutService.layer));
