import { Context, DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Ids } from "../../shared/ids.ts";
import { discountCents, priceLines } from "../../shared/money.ts";
import { CartId, CartNotFound, cartNotFound } from "../carts/CartsApi.ts";
import { CartRepository } from "../carts/CartRepository.ts";
import { CouponRepository } from "../coupons/CouponRepository.ts";
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
  CouponAlreadyRedeemed,
  CouponInvalid,
  EmptyCart,
  PriceChanged,
  cartAlreadyCheckedOut,
  couponAlreadyRedeemed,
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

        const ids = yield* Ids;
        const orderId = yield* ids.uuidv7;
        const createdAt = DateTime.formatIso(yield* DateTime.now);

        // 6. Redeem the coupon, only while it is unredeemed. No row changed
        // means the code is unknown or another order has it.
        const { couponCode = null } = request;
        let discountPercent: number | null = null;
        if (couponCode !== null) {
          const coupon = yield* coupons.redeem(couponCode, orderId, createdAt);
          if (Option.isNone(coupon)) {
            return Option.isNone(yield* coupons.findByCode(couponCode))
              ? yield* couponInvalid(couponCode)
              : yield* couponAlreadyRedeemed(couponCode);
          }
          discountPercent = coupon.value.discountPercent;
        }
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
