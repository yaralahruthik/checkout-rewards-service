import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Product } from "./ProductsApi.ts";

export class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<Product>>;
  }
>()("api/products/ProductRepository") {
  static readonly layer = Layer.effect(
    ProductRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Product,
        execute: () => sql`SELECT * FROM products ORDER BY id`,
      })().pipe(Effect.orDie, Effect.withSpan("ProductRepository.list"));

      return ProductRepository.of({ list });
    }),
  );
}
