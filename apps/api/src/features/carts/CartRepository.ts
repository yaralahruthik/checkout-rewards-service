import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Inventory, ProductId } from "../products/ProductsApi.ts";
import { Cents } from "../../shared/money.ts";
import { CartId, CartStatus, Quantity } from "./CartsApi.ts";

const CartRow = Schema.Struct({ id: CartId, status: CartStatus });
export type CartRow = typeof CartRow.Type;

/** A cart line joined with the product's current name, price and stock. */
const LineRow = Schema.Struct({
  productId: ProductId,
  productName: Schema.String,
  quantity: Quantity,
  unitPriceCents: Cents,
  availableInventory: Inventory,
});
export type LineRow = typeof LineRow.Type;

export class CartRepository extends Context.Service<
  CartRepository,
  {
    readonly insert: (cart: {
      readonly id: CartId;
      readonly createdAt: string;
    }) => Effect.Effect<CartRow>;
    readonly findById: (id: CartId) => Effect.Effect<Option.Option<CartRow>>;
    /** The cart's lines in product-id order. */
    readonly lines: (id: CartId) => Effect.Effect<ReadonlyArray<LineRow>>;
    /** Inserts the line, or replaces the quantity of an existing one. */
    readonly setQuantity: (
      id: CartId,
      productId: ProductId,
      quantity: number,
    ) => Effect.Effect<void>;
    readonly removeLine: (id: CartId, productId: ProductId) => Effect.Effect<void>;
  }
>()("api/carts/CartRepository") {
  static readonly layer = Layer.effect(
    CartRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const insert = SqlSchema.findOne({
        Request: Schema.Struct({ id: CartId, createdAt: Schema.String }),
        Result: CartRow,
        execute: ({ id, createdAt }) => sql`
          INSERT INTO carts (id, status, created_at) VALUES (${id}, 'OPEN', ${createdAt})
          RETURNING id, status
        `,
      });

      const findById = SqlSchema.findOneOption({
        Request: CartId,
        Result: CartRow,
        execute: (id) => sql`SELECT id, status FROM carts WHERE id = ${id}`,
      });

      const lines = SqlSchema.findAll({
        Request: CartId,
        Result: LineRow,
        execute: (id) => sql`
          SELECT l.product_id, p.name AS product_name, l.quantity,
                 p.unit_price_cents, p.available_inventory
          FROM cart_lines l JOIN products p ON p.id = l.product_id
          WHERE l.cart_id = ${id}
          ORDER BY l.product_id
        `,
      });

      const setQuantity = Effect.fn("CartRepository.setQuantity")(function* (
        id: CartId,
        productId: ProductId,
        quantity: number,
      ) {
        yield* sql`
            INSERT INTO cart_lines (cart_id, product_id, quantity)
            VALUES (${id}, ${productId}, ${quantity})
            ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = excluded.quantity
          `;
      }, Effect.orDie);

      const removeLine = Effect.fn("CartRepository.removeLine")(function* (
        id: CartId,
        productId: ProductId,
      ) {
        yield* sql`DELETE FROM cart_lines WHERE cart_id = ${id} AND product_id = ${productId}`;
      }, Effect.orDie);

      return CartRepository.of({
        insert: (cart) => insert(cart).pipe(Effect.orDie, Effect.withSpan("CartRepository.insert")),
        findById: (id) =>
          findById(id).pipe(Effect.orDie, Effect.withSpan("CartRepository.findById")),
        lines: (id) => lines(id).pipe(Effect.orDie, Effect.withSpan("CartRepository.lines")),
        setQuantity,
        removeLine,
      });
    }),
  );
}
