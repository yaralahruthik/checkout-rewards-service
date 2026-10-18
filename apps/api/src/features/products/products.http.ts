import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { ProductRepository } from "./ProductRepository.ts";

export const ProductsHandlers = HttpApiBuilder.group(
  Api,
  "products",
  Effect.fn("ProductsHandlers")(function* (handlers) {
    const products = yield* ProductRepository;
    return handlers.handle("listProducts", () => products.list);
  }),
).pipe(Layer.provide(ProductRepository.layer));
