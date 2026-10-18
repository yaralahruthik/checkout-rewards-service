import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { OrderId } from "../orders/OrdersApi.ts";
import { Inventory, ProductId } from "../products/ProductsApi.ts";
import { Cents } from "../../shared/money.ts";
import {
  CartId,
  CartNotFound,
  CartNotOpen,
  CartStatus,
  Quantity,
  cartNotFound,
  cartNotOpen,
} from "./CartsApi.ts";

/** `orderId` is the order the cart produced, once it is checked out. */
const CartRow = Schema.Struct({ id: CartId, status: CartStatus, orderId: Schema.NullOr(OrderId) });
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

/** What claiming a cart found: it was open and is now ours, or an order already has it. */
export type Claim =
  | { readonly _tag: "Claimed" }
  | { readonly _tag: "CheckedOut"; readonly orderId: OrderId };

export class CartRepository extends Context.Service<
  CartRepository,
  {
    readonly insert: (cart: {
      readonly id: CartId;
      readonly createdAt: string;
    }) => Effect.Effect<CartRow>;
    readonly findById: (id: CartId) => Effect.Effect<Option.Option<CartRow>>;
    /**
     * Moves the cart from `OPEN` to `CHECKED_OUT` in one conditional update.
     * `CheckedOut` with the order it produced when it was already checked out;
     * `CartNotFound` when no cart has the id.
     */
    readonly claim: (id: CartId) => Effect.Effect<Claim, CartNotFound>;
    /** The cart's lines in product-id order. */
    readonly lines: (id: CartId) => Effect.Effect<ReadonlyArray<LineRow>>;
    /**
     * Inserts the line, or replaces the quantity of an existing one, in one
     * statement guarded by the cart being `OPEN`. `CartNotOpen` when it is
     * not, or when no cart has the id.
     */
    readonly setQuantity: (
      id: CartId,
      productId: ProductId,
      quantity: number,
    ) => Effect.Effect<void, CartNotOpen>;
    /**
     * Deletes the line, guarded by the cart being `OPEN`. `CartNotOpen` when it
     * is not, or when no cart has the id; deleting a line the open cart does
     * not have is a no-op.
     */
    readonly removeLine: (id: CartId, productId: ProductId) => Effect.Effect<void, CartNotOpen>;
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
          RETURNING id, status, NULL AS order_id
        `,
      });

      const findById = SqlSchema.findOneOption({
        Request: CartId,
        Result: CartRow,
        execute: (id) => sql`
          SELECT c.id, c.status, o.id AS order_id
          FROM carts c LEFT JOIN orders o ON o.cart_id = c.id
          WHERE c.id = ${id}
        `,
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

      const claim = Effect.fn("CartRepository.claim")(function* (id: CartId) {
        const claimed = yield* sql`
          UPDATE carts SET status = 'CHECKED_OUT' WHERE id = ${id} AND status = 'OPEN'
          RETURNING id
        `.pipe(Effect.orDie);
        if (claimed.length === 1) return { _tag: "Claimed" } as const;
        // Not claimed: the cart is missing or already checked out. A cart never
        // reopens, so reading it now is safe.
        const cart = yield* findById(id).pipe(Effect.orDie);
        if (Option.isNone(cart)) {
          return yield* cartNotFound(id);
        }
        const { orderId } = cart.value;
        if (orderId === null) {
          // Claim and order insert commit together, so this cannot happen.
          return yield* Effect.die(`Cart ${id} is checked out but has no order`);
        }
        return { _tag: "CheckedOut", orderId } as const;
      });

      const setQuantity = Effect.fn("CartRepository.setQuantity")(function* (
        id: CartId,
        productId: ProductId,
        quantity: number,
      ) {
        // The guard is in the statement, so a checkout cannot land between
        // checking the status and writing the line.
        const written = yield* sql`
          INSERT INTO cart_lines (cart_id, product_id, quantity)
          SELECT id, ${productId}, ${quantity} FROM carts WHERE id = ${id} AND status = 'OPEN'
          ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = excluded.quantity
          RETURNING product_id
        `.pipe(Effect.orDie);
        if (written.length === 0) {
          return yield* cartNotOpen(id);
        }
      });

      const removeLine = Effect.fn("CartRepository.removeLine")(function* (
        id: CartId,
        productId: ProductId,
      ) {
        const removed = yield* sql`
          DELETE FROM cart_lines
          WHERE cart_id = ${id} AND product_id = ${productId}
            AND EXISTS (SELECT 1 FROM carts WHERE id = ${id} AND status = 'OPEN')
          RETURNING product_id
        `.pipe(Effect.orDie);
        if (removed.length === 1) return;
        // Nothing deleted: either the line was absent or the cart is not
        // open. A cart never reopens, so reading its status now is safe.
        const open = yield* sql`SELECT 1 FROM carts WHERE id = ${id} AND status = 'OPEN'`.pipe(
          Effect.orDie,
        );
        if (open.length === 0) {
          return yield* cartNotOpen(id);
        }
      });

      return CartRepository.of({
        insert: (cart) => insert(cart).pipe(Effect.orDie, Effect.withSpan("CartRepository.insert")),
        findById: (id) =>
          findById(id).pipe(Effect.orDie, Effect.withSpan("CartRepository.findById")),
        lines: (id) => lines(id).pipe(Effect.orDie, Effect.withSpan("CartRepository.lines")),
        claim,
        setQuantity,
        removeLine,
      });
    }),
  );
}
