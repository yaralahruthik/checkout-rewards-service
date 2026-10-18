import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { errorFields } from "../../shared/errors.ts";
import { Cents, DiscountPercent } from "../../shared/money.ts";
import { ProductId } from "../products/ProductsApi.ts";

export const OrderId = Schema.String.check(Schema.isUUID(7)).annotate({
  identifier: "OrderId",
  description: "A UUIDv7.",
});
export type OrderId = typeof OrderId.Type;

/** A line as it was at checkout: never joined to the live product. */
export const OrderLine = Schema.Struct({
  productId: ProductId,
  productName: Schema.String,
  unitPriceCents: Cents,
  quantity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  lineTotalCents: Cents,
}).annotate({
  identifier: "OrderLine",
  description: "The product's name and price as they were at checkout.",
});
export type OrderLine = typeof OrderLine.Type;

export const Order = Schema.Struct({
  id: OrderId,
  /** Sum of the line totals. */
  subtotalCents: Cents,
  discountCents: Cents,
  /** `subtotalCents - discountCents`. */
  totalCents: Cents,
  couponCode: Schema.NullOr(Schema.String).annotate({
    description: "The coupon redeemed by this order, if any.",
  }),
  discountPercent: Schema.NullOr(DiscountPercent).annotate({
    description: "The coupon's percent. `discountCents` is floor(`subtotalCents` × percent / 100).",
  }),
  createdAt: Schema.String.annotate({ description: "When the order was placed (ISO 8601, UTC)." }),
  lines: Schema.Array(OrderLine),
}).annotate({
  identifier: "Order",
  description: "A placed order. Its lines and totals never change after checkout.",
});
export type Order = typeof Order.Type;

export class OrderNotFound extends Schema.Error<OrderNotFound>("OrderNotFound")(
  errorFields("ORDER_NOT_FOUND", Schema.Struct({ orderId: Schema.String })),
  { httpApiStatus: 404, description: "No order has the given id." },
) {}

export const orderNotFound = (orderId: OrderId) =>
  new OrderNotFound({ message: `Order ${orderId} does not exist`, details: { orderId } });

export class OrdersApi extends HttpApiGroup.make("orders")
  .add(
    HttpApiEndpoint.get("getOrder", "/orders/:id", {
      params: { id: OrderId },
      success: Order,
      error: OrderNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get an order",
        description: "The order with its line snapshots and how its total was calculated.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Orders" })) {}
