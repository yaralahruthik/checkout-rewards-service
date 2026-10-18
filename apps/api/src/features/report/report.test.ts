import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** The order and coupon bodies, typed for reading fields in assertions. */
type OrderBody = {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly lines: ReadonlyArray<{ readonly productId: number; readonly quantity: number }>;
};
type CouponBody = { readonly code: string; readonly status: string };

/** A new cart holding the given `[productId, quantity]` lines. */
const cartWith = (...lines: ReadonlyArray<readonly [number, number]>) =>
  Effect.gen(function* () {
    const cart = yield* HttpClient.post("/api/carts").pipe(Effect.flatMap((r) => r.json));
    const cartId = (cart as { id: string }).id;
    for (const [productId, quantity] of lines) {
      yield* HttpClient.put(`/api/carts/${cartId}/items/${productId}`, {
        body: HttpBody.jsonUnsafe({ quantity }),
      });
    }
    return cartId;
  });

/** Checks out the cart, and returns the response status and error code. */
const checkoutCart = (cartId: string, couponCode?: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post(`/api/carts/${cartId}/checkout`, {
      body: HttpBody.jsonUnsafe(couponCode === undefined ? {} : { couponCode }),
    });
    const body = (yield* response.json) as { code?: string };
    return { status: response.status, code: body.code };
  });

/** Checks out a new cart holding the lines. */
const checkout = (
  couponCode: string | undefined,
  ...lines: ReadonlyArray<readonly [number, number]>
) => cartWith(...lines).pipe(Effect.flatMap((cartId) => checkoutCart(cartId, couponCode)));

const setInventory = (productId: number, availableInventory: number) =>
  HttpClient.patch(`/api/admin/products/${productId}`, {
    body: HttpBody.jsonUnsafe({ availableInventory }),
  });

const generate = HttpClient.post("/api/admin/coupons/generate").pipe(
  Effect.flatMap((response) => response.json),
  Effect.map((coupon) => (coupon as CouponBody).code),
);

const getJson = (path: string) =>
  HttpClient.get(path).pipe(Effect.flatMap((response) => response.json));

const sum = (values: ReadonlyArray<number>) => values.reduce((total, n) => total + n, 0);

it.effect(
  "after discounted, undiscounted and failed checkouts the report reconciles with the listed orders and coupons, and reading it changes nothing",
  () =>
    Effect.gen(function* () {
      // n = 5, x = 10. Fifteen orders, three coupons, two of them redeemed.
      yield* checkout(undefined, [1, 1]);
      yield* checkout(undefined, [2, 2]);
      yield* checkout(undefined, [4, 1]);
      yield* checkout(undefined, [3, 1]);
      yield* checkout(undefined, [1, 1], [4, 2]);
      const first = yield* generate;
      const short = yield* cartWith([6, 2]);
      yield* setInventory(6, 1);
      assert.deepStrictEqual(yield* checkoutCart(short, first), {
        status: 409,
        code: "INSUFFICIENT_INVENTORY",
      });
      yield* setInventory(6, 3);
      assert.deepStrictEqual(yield* checkout(first, [4, 1]), { status: 201, code: undefined });
      assert.deepStrictEqual(yield* checkout(first, [2, 1]), {
        status: 409,
        code: "COUPON_ALREADY_REDEEMED",
      });
      assert.deepStrictEqual(yield* checkout("SAVE10-NOTACODE", [2, 1]), {
        status: 422,
        code: "COUPON_INVALID",
      });
      yield* checkout(undefined, [6, 3]);
      yield* checkout(undefined, [2, 1]);
      yield* checkout(undefined, [5, 1]);
      yield* checkout(undefined, [3, 2]);
      const second = yield* generate;
      assert.deepStrictEqual(yield* checkout(second, [5, 1]), { status: 201, code: undefined });
      for (let i = 0; i < 4; i++) yield* checkout(undefined, [2, 1]);
      yield* generate;

      const orders = (yield* getJson("/api/admin/orders")) as ReadonlyArray<OrderBody>;
      const coupons = (yield* getJson("/api/admin/coupons")) as ReadonlyArray<CouponBody>;
      const response = yield* HttpClient.get("/api/admin/report");
      assert.strictEqual(response.status, 200);
      const report = (yield* response.json) as {
        readonly orderCount: number;
        readonly grossRevenueCents: number;
        readonly totalDiscountsCents: number;
        readonly netRevenueCents: number;
        readonly coupons: { generated: number; available: number; redeemed: number };
        readonly products: ReadonlyArray<{ productId: number; purchasedQuantity: number }>;
      };

      // Worked by hand from the seeded prices.
      assert.deepStrictEqual<unknown>(report, {
        orderCount: 15,
        grossRevenueCents: 98979,
        totalDiscountsCents: 1698,
        netRevenueCents: 97281,
        coupons: { generated: 3, available: 1, redeemed: 2 },
        products: [
          { productId: 1, purchasedQuantity: 2 },
          { productId: 2, purchasedQuantity: 7 },
          { productId: 3, purchasedQuantity: 3 },
          { productId: 4, purchasedQuantity: 4 },
          { productId: 5, purchasedQuantity: 2 },
          { productId: 6, purchasedQuantity: 3 },
        ],
      });

      // Every figure is the sum over what the other admin endpoints list.
      assert.strictEqual(report.orderCount, orders.length);
      assert.strictEqual(report.grossRevenueCents, sum(orders.map((o) => o.subtotalCents)));
      assert.strictEqual(report.totalDiscountsCents, sum(orders.map((o) => o.discountCents)));
      assert.strictEqual(report.netRevenueCents, sum(orders.map((o) => o.totalCents)));
      assert.strictEqual(
        report.grossRevenueCents - report.totalDiscountsCents,
        report.netRevenueCents,
      );
      assert.deepStrictEqual(report.coupons, {
        generated: coupons.length,
        available: coupons.filter((c) => c.status === "AVAILABLE").length,
        redeemed: coupons.filter((c) => c.status === "REDEEMED").length,
      });
      for (const { productId, purchasedQuantity } of report.products) {
        const lines = orders.flatMap((o) => o.lines).filter((l) => l.productId === productId);
        assert.strictEqual(purchasedQuantity, sum(lines.map((l) => l.quantity)));
      }
      assert.strictEqual(
        sum(report.products.map((p) => p.purchasedQuantity)),
        sum(orders.flatMap((o) => o.lines).map((l) => l.quantity)),
      );

      // Reading the report is a pure read.
      assert.deepStrictEqual(yield* getJson("/api/admin/report"), report);
      assert.deepStrictEqual(yield* getJson("/api/admin/orders"), orders);
      assert.deepStrictEqual(yield* getJson("/api/admin/coupons"), coupons);
    }).pipe(Effect.provide(TestApi)),
);

it.effect("with no orders the report is all zeros", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* getJson("/api/admin/report"), {
      orderCount: 0,
      grossRevenueCents: 0,
      totalDiscountsCents: 0,
      netRevenueCents: 0,
      coupons: { generated: 0, available: 0, redeemed: 0 },
      products: [],
    });
  }).pipe(Effect.provide(TestApi)),
);
