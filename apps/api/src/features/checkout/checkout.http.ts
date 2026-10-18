import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { CheckoutService } from "./CheckoutService.ts";

const CheckoutGroup = HttpApiBuilder.group(
  Api,
  "checkout",
  Effect.fn("CheckoutHandlers")(function* (handlers) {
    const checkout = yield* CheckoutService;
    return handlers.handle("checkout", ({ params }) => checkout.checkout(params.id));
  }),
);

export const CheckoutHandlers = CheckoutGroup.pipe(Layer.provide(CheckoutService.layer));
