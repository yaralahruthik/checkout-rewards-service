import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Product, ProductId, ProductUpdate } from "./ProductsApi.ts";

export class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<Product>>;
    /** Applies the update and returns the product, or `None` if it does not exist. */
    readonly update: (
      id: typeof ProductId.Type,
      update: ProductUpdate,
    ) => Effect.Effect<Option.Option<Product>>;
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

      // One statement, so the read-back can never disagree with the write.
      const updateQuery = SqlSchema.findOneOption({
        Request: Schema.Struct({
          id: ProductId,
          unitPriceCents: Schema.NullOr(Schema.Int),
          inventory: Schema.NullOr(Schema.Int),
        }),
        Result: Product,
        execute: ({ id, unitPriceCents, inventory }) => sql`
          UPDATE products
          SET unit_price_cents = COALESCE(${unitPriceCents}, unit_price_cents),
              available_inventory = COALESCE(${inventory}, available_inventory)
          WHERE id = ${id}
          RETURNING *
        `,
      });

      const update = Effect.fn("ProductRepository.update")(function* (
        id: typeof ProductId.Type,
        update: ProductUpdate,
      ) {
        return yield* updateQuery({
          id,
          unitPriceCents: update.unitPriceCents ?? null,
          inventory: update.inventory ?? null,
        });
      }, Effect.orDie);

      return ProductRepository.of({ list, update });
    }),
  );
}
