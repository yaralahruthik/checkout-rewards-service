import { Context, DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Ids } from "../../shared/ids.ts";
import { lineTotalCents, subtotalCents } from "../../shared/money.ts";
import { CartId, CartNotFound, cartNotFound } from "../carts/CartsApi.ts";
import { CartRepository } from "../carts/CartRepository.ts";
import { Order } from "../orders/OrdersApi.ts";
import { OrderRepository } from "../orders/OrderRepository.ts";
import {
  InsufficientInventory,
  type ShortLine,
  insufficientInventory,
} from "../products/ProductsApi.ts";
import { ProductRepository } from "../products/ProductRepository.ts";
import {
  CartAlreadyCheckedOut,
  type CheckoutRequest,
  CouponInvalid,
  EmptyCart,
  PriceChanged,
  cartAlreadyCheckedOut,
  couponInvalid,
  emptyCart,
  priceChanged,
} from "./CheckoutApi.ts";

/** `replayed` when the cart was already checked out and `order` is the one it produced. */
export type CheckoutResult = { readonly order: Order; readonly replayed: boolean };

export class CheckoutService extends Context.Service<
  CheckoutService,
  {
    readonly checkout: (
      id: CartId,
      request: CheckoutRequest,
    ) => Effect.Effect<
      CheckoutResult,
      | CartNotFound
      | CartAlreadyCheckedOut
      | EmptyCart
      | PriceChanged
      | InsufficientInventory
      | CouponInvalid
    >;
  }
>()("api/checkout/CheckoutService") {
  static readonly layer = Layer.effect(
    CheckoutService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const carts = yield* CartRepository;
      const products = yield* ProductRepository;
      const orders = yield* OrderRepository;

      const placeOrder = Effect.fn("CheckoutService.placeOrder")(function* (
        cartId: CartId,
        request: CheckoutRequest,
      ) {
        // 1. Claim the cart. Only one checkout can move it out of OPEN.
        if (!(yield* carts.claim(cartId))) {
          const cart = yield* carts.findById(cartId);
          if (Option.isNone(cart)) {
            return yield* cartNotFound(cartId);
          }
          const { orderId } = cart.value;
          if (orderId === null) {
            // Claim and order insert commit together, so this cannot happen.
            return yield* Effect.die(`Cart ${cartId} is checked out but has no order`);
          }
          // A retry of the original request replays its order. No order has
          // a coupon yet, so only a request without one matches.
          if (request.couponCode === undefined) {
            const order = yield* orders.findById(orderId);
            if (Option.isNone(order)) {
              return yield* Effect.die(`Order ${orderId} of cart ${cartId} does not exist`);
            }
            return { order: order.value, replayed: true };
          }
          return yield* cartAlreadyCheckedOut(cartId, orderId);
        }

        // 2. Load the lines, in product-id order.
        const cartLines = yield* carts.lines(cartId);
        if (cartLines.length === 0) {
          return yield* emptyCart(cartId);
        }

        // 3. Price them at current prices.
        const lines = cartLines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          lineTotalCents: lineTotalCents(line.unitPriceCents, line.quantity),
        }));
        const subtotal = subtotalCents(lines);

        // 4. Refuse a subtotal the shopper did not see.
        const { expectedSubtotalCents } = request;
        if (expectedSubtotalCents !== undefined && expectedSubtotalCents !== subtotal) {
          return yield* priceChanged({ expectedSubtotalCents, subtotalCents: subtotal, lines });
        }

        // 5. Take the stock, in product-id order. Keep going past a short line
        // so the error lists every one; the rollback undoes the others.
        const short: Array<ShortLine> = [];
        for (const line of lines) {
          if (yield* products.decrementInventory(line.productId, line.quantity)) continue;
          const product = yield* products.findById(line.productId);
          short.push({
            productId: line.productId,
            requestedQuantity: line.quantity,
            availableInventory: Option.match(product, {
              onNone: () => 0,
              onSome: (product) => product.availableInventory,
            }),
          });
        }
        if (short.length > 0) {
          return yield* insufficientInventory(short);
        }

        // 6. Redeem the coupon. None exist yet, so every code is unknown.
        if (request.couponCode !== undefined) {
          return yield* couponInvalid(request.couponCode);
        }

        // 7. Record the order and its snapshots.
        const ids = yield* Ids;
        const order: Order = {
          id: yield* ids.uuidv7,
          subtotalCents: subtotal,
          discountCents: 0,
          totalCents: subtotal,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          lines,
        };
        yield* orders.insert({ ...order, cartId });
        return { order, replayed: false };
      });

      // 8. Commit, or roll back every write above if any step failed.
      const checkout = (cartId: CartId, request: CheckoutRequest) =>
        sql
          .withTransaction(placeOrder(cartId, request))
          .pipe(Effect.catchTag("SqlError", Effect.die));

      return CheckoutService.of({ checkout });
    }),
  ).pipe(Layer.provide([CartRepository.layer, ProductRepository.layer, OrderRepository.layer]));
}
