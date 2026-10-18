import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { Count } from "../../shared/count.ts";
import { errorFields } from "../../shared/errors.ts";
import { Cents } from "../../shared/money.ts";
import { OrderId } from "../orders/OrdersApi.ts";
import {
  InsufficientInventory,
  Inventory,
  ProductId,
  ProductNotFound,
} from "../products/ProductsApi.ts";

/** The cart's UUIDv7. Knowing it is the only credential for the cart. */
export const CartId = Schema.String.check(Schema.isUUID(7)).annotate({
  identifier: "CartId",
  description: "A UUIDv7. Anyone holding it can read and change the cart.",
});
export type CartId = typeof CartId.Type;

export const CartStatus = Schema.Literals(["OPEN", "CHECKED_OUT"]).annotate({
  identifier: "CartStatus",
});
export type CartStatus = typeof CartStatus.Type;

export const Quantity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })).annotate({
  identifier: "Quantity",
  description: "Units of a product on one cart line: an integer from 1 to 99.",
});

export const CartLine = Schema.Struct({
  productId: ProductId,
  productName: Schema.String,
  quantity: Quantity,
  /** The product's current price: lines store no price. */
  unitPriceCents: Cents,
  lineTotalCents: Cents,
  availableInventory: Inventory,
  /** True when the quantity now exceeds the available inventory. */
  insufficientStock: Schema.Boolean,
}).annotate({ identifier: "CartLine" });
export type CartLine = typeof CartLine.Type;

export const Cart = Schema.Struct({
  id: CartId,
  status: CartStatus,
  /** Total units across all lines. */
  itemCount: Count,
  subtotalCents: Cents,
  lines: Schema.Array(CartLine),
  /** Present once the cart is checked out: the order it produced. */
  orderId: Schema.optionalKey(OrderId),
}).annotate({
  identifier: "Cart",
  description:
    "The cart priced at current product prices. Totals change when prices change; nothing is reserved.",
});
export type Cart = typeof Cart.Type;

export const SetQuantity = Schema.Struct({ quantity: Quantity }).annotate({
  identifier: "SetQuantity",
});
export type SetQuantity = typeof SetQuantity.Type;

export class CartNotFound extends Schema.Error<CartNotFound>("CartNotFound")(
  errorFields("CART_NOT_FOUND", Schema.Struct({ cartId: Schema.String })),
  { httpApiStatus: 404, description: "No cart has the given id." },
) {}

export const cartNotFound = (cartId: CartId) =>
  new CartNotFound({ message: `Cart ${cartId} does not exist`, details: { cartId } });

export class CartNotOpen extends Schema.Error<CartNotOpen>("CartNotOpen")(
  errorFields("CART_NOT_OPEN", Schema.Struct({ cartId: Schema.String })),
  { httpApiStatus: 409, description: "The cart is checked out, so its lines cannot change." },
) {}

export const cartNotOpen = (cartId: CartId) =>
  new CartNotOpen({ message: `Cart ${cartId} is not open`, details: { cartId } });

export class CartsApi extends HttpApiGroup.make("carts")
  .add(
    HttpApiEndpoint.post("createCart", "/carts", {
      success: Cart.pipe(HttpApiSchema.status(201)),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Create a cart",
        description:
          "Creates an empty open cart. Keep its id: it is the only way to reach the cart.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("getCart", "/carts/:id", {
      params: { id: CartId },
      success: Cart,
      error: CartNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a cart",
        description:
          "Each line with its live unit price, line total and available inventory, plus the subtotal.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("setItemQuantity", "/carts/:id/items/:productId", {
      params: { id: CartId, productId: ProductId },
      payload: SetQuantity,
      success: Cart,
      error: [CartNotFound, CartNotOpen, ProductNotFound, InsufficientInventory],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Set an item's quantity",
        description:
          "Creates the line or replaces its quantity. Never adds to the existing quantity, so retrying is safe. The quantity is checked against current inventory, but nothing is reserved: checkout checks again.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("removeItem", "/carts/:id/items/:productId", {
      params: { id: CartId, productId: ProductId },
      success: Cart,
      error: [CartNotFound, CartNotOpen],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Remove an item",
        description:
          "Deletes the product's line. Removing a product that is not in the cart changes nothing, so retrying is safe.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Carts" })) {}
