import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { ProductService } from "./ProductService.ts";

const ProductsGroup = HttpApiBuilder.group(
  Api,
  "products",
  Effect.fn("ProductsHandlers")(function* (handlers) {
    const products = yield* ProductService;
    return handlers.handle("listProducts", () => products.list);
  }),
);

const AdminProductsGroup = HttpApiBuilder.group(
  Api,
  "adminProducts",
  Effect.fn("AdminProductsHandlers")(function* (handlers) {
    const products = yield* ProductService;
    return handlers.handle("updateProduct", ({ params, payload }) =>
      products.update(params.id, payload),
    );
  }),
);

export const ProductsHandlers = Layer.mergeAll(ProductsGroup, AdminProductsGroup).pipe(
  Layer.provide(ProductService.layer),
);
