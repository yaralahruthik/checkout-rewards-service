import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Product, ProductId, ProductUpdate } from "./ProductsApi.ts";

export class ProductRepository extends Context.Service<
  ProductRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<Product>>;
    readonly findById: (id: ProductId) => Effect.Effect<Option.Option<Product>>;
    /** Applies the update and returns the product, or `None` if it does not exist. */
    readonly update: (
      id: ProductId,
      update: ProductUpdate,
    ) => Effect.Effect<Option.Option<Product>>;
    /**
     * Takes `quantity` units in one conditional update that only succeeds
     * while at least that many are available. `false` when there are not.
     */
    readonly decrementInventory: (id: ProductId, quantity: number) => Effect.Effect<boolean>;
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

      const findById = SqlSchema.findOneOption({
        Request: ProductId,
        Result: Product,
        execute: (id) => sql`SELECT * FROM products WHERE id = ${id}`,
      });

      // One statement, so the read-back can never disagree with the write.
      const updateQuery = SqlSchema.findOneOption({
        Request: Schema.Struct({
          id: ProductId,
          unitPriceCents: Schema.NullOr(Schema.Int),
          availableInventory: Schema.NullOr(Schema.Int),
        }),
        Result: Product,
        execute: ({ id, unitPriceCents, availableInventory }) => sql`
          UPDATE products
          SET unit_price_cents = COALESCE(${unitPriceCents}, unit_price_cents),
              available_inventory = COALESCE(${availableInventory}, available_inventory)
          WHERE id = ${id}
          RETURNING *
        `,
      });

      const update = Effect.fn("ProductRepository.update")(function* (
        id: ProductId,
        update: ProductUpdate,
      ) {
        return yield* updateQuery({
          id,
          unitPriceCents: update.unitPriceCents ?? null,
          availableInventory: update.availableInventory ?? null,
        });
      }, Effect.orDie);

      // The guard is in the statement itself, so no read-then-write gap exists
      // for a concurrent checkout to slip into.
      const decrementInventory = Effect.fn("ProductRepository.decrementInventory")(function* (
        id: ProductId,
        quantity: number,
      ) {
        const updated = yield* sql`
          UPDATE products SET available_inventory = available_inventory - ${quantity}
          WHERE id = ${id} AND available_inventory >= ${quantity}
          RETURNING id
        `;
        return updated.length === 1;
      }, Effect.orDie);

      return ProductRepository.of({
        list,
        findById: (id) =>
          findById(id).pipe(Effect.orDie, Effect.withSpan("ProductRepository.findById")),
        update,
        decrementInventory,
      });
    }),
  );
}
