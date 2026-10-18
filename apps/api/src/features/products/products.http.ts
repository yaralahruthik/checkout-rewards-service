import { Effect, Layer, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { ProductNotFound } from "./ProductsApi.ts";
import { ProductRepository } from "./ProductRepository.ts";

export const ProductsHandlers = HttpApiBuilder.group(
  Api,
  "products",
  Effect.fn("ProductsHandlers")(function* (handlers) {
    const products = yield* ProductRepository;
    return handlers.handle("listProducts", () => products.list);
  }),
).pipe(Layer.provide(ProductRepository.layer));

export const AdminProductsHandlers = HttpApiBuilder.group(
  Api,
  "adminProducts",
  Effect.fn("AdminProductsHandlers")(function* (handlers) {
    const products = yield* ProductRepository;
    return handlers.handle("updateProduct", ({ params, payload }) =>
      products.update(params.id, payload).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ProductNotFound({
                  message: `Product ${params.id} does not exist`,
                  details: { productId: params.id },
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    );
  }),
).pipe(Layer.provide(ProductRepository.layer));
