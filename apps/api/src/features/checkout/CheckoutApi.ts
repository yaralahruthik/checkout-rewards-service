import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { errorFields } from "../../shared/errors.ts";
import { CartId, CartNotFound } from "../carts/CartsApi.ts";
import { Order, type OrderId } from "../orders/OrdersApi.ts";
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

export class CheckoutApi extends HttpApiGroup.make("checkout")
  .add(
    HttpApiEndpoint.post("checkout", "/carts/:id/checkout", {
      params: { id: CartId },
      success: Order.pipe(HttpApiSchema.status(201)),
      error: [CartNotFound, CartAlreadyCheckedOut, EmptyCart, InsufficientInventory],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Check out a cart",
        description:
          "In one transaction: closes the cart, prices its lines at current prices, takes the stock, and records the order with snapshots of every line. If any step fails, nothing changes: the cart stays open and stock is untouched.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Checkout" })) {}
