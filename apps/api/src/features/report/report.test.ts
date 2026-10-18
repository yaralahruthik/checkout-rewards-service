import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient, type HttpClientResponse } from "effect/http";
import { cartWith, checkout, placeOrder } from "../../testing/shop.ts";
import { TestApi } from "../../testing/TestApi.ts";

/** The response bodies, typed for reading fields in assertions. */
type OrderBody = {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly lines: ReadonlyArray<{
    readonly productId: number;
    readonly productName: string;
    readonly quantity: number;
  }>;
};
type CouponBody = { readonly code: string; readonly status: string };
type ReportBody = {
  readonly orderCount: number;
  readonly grossRevenueCents: number;
  readonly totalDiscountsCents: number;
  readonly netRevenueCents: number;
  readonly coupons: { generated: number; available: number; redeemed: number };
  readonly products: ReadonlyArray<{
    productId: number;
    productName: string;
    purchasedQuantity: number;
  }>;
};

/** The response status and, for an error, its code. */
const outcome = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.map((body) => ({ status: response.status, code: (body as { code?: string }).code })),
  );

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
      yield* placeOrder([1, 1]);
      yield* placeOrder([2, 2]);
      yield* placeOrder([4, 1]);
      yield* placeOrder([3, 1]);
      yield* placeOrder([1, 1], [4, 2]);
      const first = yield* generate;
      const short = yield* cartWith([6, 2]);
      yield* setInventory(6, 1);
      assert.deepStrictEqual(yield* outcome(yield* checkout(short, { couponCode: first })), {
        status: 409,
        code: "INSUFFICIENT_INVENTORY",
      });
      yield* setInventory(6, 3);
      const discounted = yield* checkout(yield* cartWith([4, 1]), { couponCode: first });
      assert.strictEqual(discounted.status, 201);
      const taken = yield* checkout(yield* cartWith([2, 1]), { couponCode: first });
      assert.deepStrictEqual(yield* outcome(taken), {
        status: 409,
        code: "COUPON_ALREADY_REDEEMED",
      });
      const unknown = yield* checkout(yield* cartWith([2, 1]), { couponCode: "SAVE10-NOTACODE" });
      assert.deepStrictEqual(yield* outcome(unknown), { status: 422, code: "COUPON_INVALID" });
      yield* placeOrder([6, 3]);
      yield* placeOrder([2, 1]);
      yield* placeOrder([5, 1]);
      yield* placeOrder([3, 2]);
      const second = yield* generate;
      const discountedAgain = yield* checkout(yield* cartWith([5, 1]), { couponCode: second });
      assert.strictEqual(discountedAgain.status, 201);
      for (let i = 0; i < 4; i++) yield* placeOrder([2, 1]);
      yield* generate;

      const orders = (yield* getJson("/api/admin/orders")) as ReadonlyArray<OrderBody>;
      const coupons = (yield* getJson("/api/admin/coupons")) as ReadonlyArray<CouponBody>;
      const response = yield* HttpClient.get("/api/admin/report");
      assert.strictEqual(response.status, 200);
      const report = (yield* response.json) as ReportBody;

      // Worked by hand from the seeded prices.
      assert.deepStrictEqual<unknown>(report, {
        orderCount: 15,
        grossRevenueCents: 98979,
        totalDiscountsCents: 1698,
        netRevenueCents: 97281,
        coupons: { generated: 3, available: 1, redeemed: 2 },
        products: [
          { productId: 1, productName: "Mechanical Keyboard", purchasedQuantity: 2 },
          { productId: 2, productName: "Wireless Mouse", purchasedQuantity: 7 },
          { productId: 3, productName: "USB-C Hub", purchasedQuantity: 3 },
          { productId: 4, productName: "Laptop Stand", purchasedQuantity: 4 },
          { productId: 5, productName: "Noise-Cancelling Headphones", purchasedQuantity: 2 },
          { productId: 6, productName: "Limited Edition Keycap Set", purchasedQuantity: 3 },
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
      const allLines = orders.flatMap((o) => o.lines);
      for (const { productId, productName, purchasedQuantity } of report.products) {
        const lines = allLines.filter((l) => l.productId === productId);
        assert.strictEqual(purchasedQuantity, sum(lines.map((l) => l.quantity)));
        assert.strictEqual(productName, lines[0]!.productName);
      }
      assert.strictEqual(
        sum(report.products.map((p) => p.purchasedQuantity)),
        sum(allLines.map((l) => l.quantity)),
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
