import { Context, DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Ids } from "../../shared/ids.ts";
import { discountCents, priceLines } from "../../shared/money.ts";
import { CartId, CartNotFound } from "../carts/CartsApi.ts";
import { CartRepository } from "../carts/CartRepository.ts";
import { CouponAlreadyRedeemed, CouponInvalid } from "../coupons/CouponsApi.ts";
import { CouponRepository } from "../coupons/CouponRepository.ts";
import { Order } from "../orders/OrdersApi.ts";
import { OrderRepository } from "../orders/OrderRepository.ts";
import { InsufficientInventory } from "../products/ProductsApi.ts";
import { ProductRepository } from "../products/ProductRepository.ts";
import {
  CartAlreadyCheckedOut,
  type CheckoutRequest,
  EmptyCart,
  PriceChanged,
  cartAlreadyCheckedOut,
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
      | CouponAlreadyRedeemed
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
      const coupons = yield* CouponRepository;

      const placeOrder = Effect.fn("CheckoutService.placeOrder")(function* (
        cartId: CartId,
        request: CheckoutRequest,
      ) {
        // 1. Claim the cart. Only one checkout can move it out of OPEN.
        const claim = yield* carts.claim(cartId);
        if (claim._tag === "CheckedOut") {
          const { orderId } = claim;
          // A retry of the original request, with the same coupon code or
          // none, replays its order.
          const order = yield* orders.findById(orderId);
          if (Option.isNone(order)) {
            return yield* Effect.die(`Order ${orderId} of cart ${cartId} does not exist`);
          }
          if ((request.couponCode ?? null) === order.value.couponCode) {
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
        const { lines, subtotalCents: subtotal } = priceLines(
          cartLines.map((line) => ({
            productId: line.productId,
            productName: line.productName,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
          })),
        );

        // 4. Refuse a subtotal the shopper did not see.
        const { expectedSubtotalCents } = request;
        if (expectedSubtotalCents !== undefined && expectedSubtotalCents !== subtotal) {
          return yield* priceChanged({ expectedSubtotalCents, subtotalCents: subtotal, lines });
        }

        // 5. Take the stock. Every line is attempted, so the error lists every
        // short one; the rollback undoes the others.
        yield* products.decrementInventory(lines);

        const ids = yield* Ids;
        const orderId = yield* ids.uuidv7;
        const createdAt = DateTime.formatIso(yield* DateTime.now);

        // 6. Redeem the coupon, only while it is unredeemed.
        const { couponCode = null } = request;
        const discountPercent =
          couponCode === null
            ? null
            : (yield* coupons.redeem(couponCode, orderId, createdAt)).discountPercent;
        const discount = discountPercent === null ? 0 : discountCents(subtotal, discountPercent);

        // 7. Record the order and its snapshots.
        const order: Order = {
          id: orderId,
          subtotalCents: subtotal,
          discountCents: discount,
          totalCents: subtotal - discount,
          couponCode,
          discountPercent,
          createdAt,
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
  ).pipe(
    Layer.provide([
      CartRepository.layer,
      ProductRepository.layer,
      OrderRepository.layer,
      CouponRepository.layer,
    ]),
  );
}
