import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { errorFields } from "../../shared/errors.ts";
import { Cents } from "../../shared/money.ts";
import { CartId, CartNotFound } from "../carts/CartsApi.ts";
import { Order, type OrderId, OrderLine } from "../orders/OrdersApi.ts";
import { InsufficientInventory } from "../products/ProductsApi.ts";

export class EmptyCart extends Schema.Error<EmptyCart>("EmptyCart")(
  errorFields("EMPTY_CART", Schema.Struct({ cartId: Schema.String })),
  { httpApiStatus: 422, description: "The cart has no lines, so there is nothing to order." },
) {}

export const emptyCart = (cartId: CartId) =>
  new EmptyCart({ message: `Cart ${cartId} is empty`, details: { cartId } });

export class CartAlreadyCheckedOut extends Schema.Error<CartAlreadyCheckedOut>(
  "CartAlreadyCheckedOut",
)(
  errorFields(
    "CART_ALREADY_CHECKED_OUT",
    Schema.Struct({ cartId: Schema.String, orderId: Schema.String }),
  ),
  {
    httpApiStatus: 409,
    description: "The cart was already checked out; `orderId` is the order it produced.",
  },
) {}

export const cartAlreadyCheckedOut = (cartId: CartId, orderId: OrderId) =>
  new CartAlreadyCheckedOut({
    message: `Cart ${cartId} is already checked out`,
    details: { cartId, orderId },
  });

export class PriceChanged extends Schema.Error<PriceChanged>("PriceChanged")(
  errorFields(
    "PRICE_CHANGED",
    Schema.Struct({
      expectedSubtotalCents: Cents,
      subtotalCents: Cents,
      /** The lines priced as checkout priced them. */
      lines: Schema.Array(OrderLine),
    }),
  ),
  {
    httpApiStatus: 409,
    description:
      "The current subtotal differs from `expectedSubtotalCents`. Nothing changed: the cart is still open. Confirm the new totals and check out again with the new subtotal.",
  },
) {}

export const priceChanged = (details: PriceChanged["details"]) =>
  new PriceChanged({
    message: `The subtotal is now ${details.subtotalCents} cents, not ${details.expectedSubtotalCents}`,
    details,
  });

export class CouponInvalid extends Schema.Error<CouponInvalid>("CouponInvalid")(
  errorFields("COUPON_INVALID", Schema.Struct({ couponCode: Schema.String })),
  { httpApiStatus: 422, description: "No coupon has the given code." },
) {}

export const couponInvalid = (couponCode: string) =>
  new CouponInvalid({ message: `Coupon ${couponCode} does not exist`, details: { couponCode } });

export const CheckoutRequest = Schema.Struct({
  couponCode: Schema.optionalKey(Schema.String),
  /** The subtotal the shopper saw. Checkout is refused if it differs from the current one. */
  expectedSubtotalCents: Schema.optionalKey(Cents),
}).annotate({
  identifier: "CheckoutRequest",
  description:
    "Both fields are optional, and so is the body. A retry must send the same coupon code (or none) to replay the order.",
});
export type CheckoutRequest = typeof CheckoutRequest.Type;

export class CheckoutApi extends HttpApiGroup.make("checkout")
  .add(
    HttpApiEndpoint.post("checkout", "/carts/:id/checkout", {
      params: { id: CartId },
      payload: [CheckoutRequest, Schema.Null],
      success: [Order.pipe(HttpApiSchema.status(201)), Order],
      error: [
        CartNotFound,
        CartAlreadyCheckedOut,
        EmptyCart,
        PriceChanged,
        InsufficientInventory,
        CouponInvalid,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Check out a cart",
        description:
          "In one transaction: closes the cart, prices its lines at current prices, takes the stock, and records the order with snapshots of every line. If any step fails, nothing changes: the cart stays open and stock is untouched.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Checkout" })) {}
