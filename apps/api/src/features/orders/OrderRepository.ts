import { Context, Effect, Layer, Option, Struct } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { CartId } from "../carts/CartsApi.ts";
import { Order, OrderId, OrderLine } from "./OrdersApi.ts";

const OrderRow = Order.mapFields(Struct.omit(["lines"]));

/** An order to record, with the cart it was placed from. */
export type NewOrder = Order & { readonly cartId: CartId };

export class OrderRepository extends Context.Service<
  OrderRepository,
  {
    /** Inserts the order and its line snapshots. Run it inside the checkout transaction. */
    readonly insert: (order: NewOrder) => Effect.Effect<void>;
    readonly findById: (id: OrderId) => Effect.Effect<Option.Option<Order>>;
  }
>()("api/orders/OrderRepository") {
  static readonly layer = Layer.effect(
    OrderRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const insert = Effect.fn("OrderRepository.insert")(function* ({ lines, ...order }: NewOrder) {
        yield* sql`INSERT INTO orders ${sql.insert(order)}`;
        yield* sql`INSERT INTO order_lines ${sql.insert(
          lines.map((line) => ({ orderId: order.id, ...line })),
        )}`;
      }, Effect.orDie);

      const findOrder = SqlSchema.findOneOption({
        Request: OrderId,
        Result: OrderRow,
        execute: (id) => sql`
          SELECT id, subtotal_cents, discount_cents, total_cents, created_at
          FROM orders WHERE id = ${id}
        `,
      });

      const findLines = SqlSchema.findAll({
        Request: OrderId,
        Result: OrderLine,
        execute: (id) => sql`
          SELECT product_id, product_name, unit_price_cents, quantity, line_total_cents
          FROM order_lines WHERE order_id = ${id}
          ORDER BY product_id
        `,
      });

      const findById = Effect.fn("OrderRepository.findById")(function* (id: OrderId) {
        const order = yield* findOrder(id);
        if (Option.isNone(order)) return Option.none();
        return Option.some({ ...order.value, lines: yield* findLines(id) });
      }, Effect.orDie);

      return OrderRepository.of({ insert, findById });
    }),
  );
}
