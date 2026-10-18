import { Context, Effect, Layer, Option } from "effect";
import {
  Product,
  ProductId,
  ProductNotFound,
  ProductUpdate,
  productNotFound,
} from "./ProductsApi.ts";
import { ProductRepository } from "./ProductRepository.ts";

export class ProductService extends Context.Service<
  ProductService,
  {
    readonly list: Effect.Effect<ReadonlyArray<Product>>;
    readonly update: (
      id: ProductId,
      update: ProductUpdate,
    ) => Effect.Effect<Product, ProductNotFound>;
  }
>()("api/products/ProductService") {
  static readonly layer = Layer.effect(
    ProductService,
    Effect.gen(function* () {
      const repository = yield* ProductRepository;

      const update = Effect.fn("ProductService.update")(function* (
        id: ProductId,
        update: ProductUpdate,
      ) {
        const product = yield* repository.update(id, update);
        if (Option.isNone(product)) {
          return yield* productNotFound(id);
        }
        return product.value;
      });

      return ProductService.of({ list: repository.list, update });
    }),
  ).pipe(Layer.provide(ProductRepository.layer));
}
