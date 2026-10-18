import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  InsufficientInventory,
  Product,
  ProductId,
  ProductUpdate,
  type ShortLine,
  insufficientInventory,
} from "./ProductsApi.ts";

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
     * Takes each line's quantity, in product-id order, each in one conditional
     * update that only succeeds while at least that many are available. Every
     * line is attempted, so `InsufficientInventory` lists every short one. Run
     * it inside a transaction: lines taken before a short one are only undone
     * by the rollback.
     */
    readonly decrementInventory: (
      lines: ReadonlyArray<{ readonly productId: ProductId; readonly quantity: number }>,
    ) => Effect.Effect<void, InsufficientInventory>;
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
      // for a concurrent checkout to slip into. Product-id order means two
      // checkouts sharing products lock their rows in the same order.
      const decrementInventory = Effect.fn("ProductRepository.decrementInventory")(function* (
        lines: ReadonlyArray<{ readonly productId: ProductId; readonly quantity: number }>,
      ) {
        const short: Array<ShortLine> = [];
        for (const { productId, quantity } of [...lines].sort(
          (a, b) => a.productId - b.productId,
        )) {
          const updated = yield* sql`
            UPDATE products SET available_inventory = available_inventory - ${quantity}
            WHERE id = ${productId} AND available_inventory >= ${quantity}
            RETURNING id
          `.pipe(Effect.orDie);
          if (updated.length === 1) continue;
          const product = yield* findById(productId).pipe(Effect.orDie);
          short.push({
            productId,
            requestedQuantity: quantity,
            availableInventory: Option.match(product, {
              onNone: () => 0,
              onSome: (product) => product.availableInventory,
            }),
          });
        }
        if (short.length > 0) {
          return yield* insufficientInventory(short);
        }
      });

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
