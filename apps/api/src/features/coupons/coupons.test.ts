import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { TestApi } from "../../testing/TestApi.ts";

/** The coupon response body, typed for reading fields in assertions. */
type CouponBody = {
  readonly code: string;
  readonly milestoneOrderCount: number;
  readonly discountPercent: number;
  readonly status: string;
  readonly createdAt: string;
  readonly redeemedOrderId: string | null;
  readonly redeemedAt: string | null;
};

// TestApi runs with n = 5 and x = 10.
const COUPON_CODE = /^SAVE10-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** Places `count` orders, each from a new cart holding one unit of product 1. */
const placeOrders = (count: number) =>
  Effect.forEach(Array.from({ length: count }), () =>
    Effect.gen(function* () {
      const cart = yield* HttpClient.post("/api/carts").pipe(Effect.flatMap((r) => r.json));
      const cartId = (cart as { id: string }).id;
      yield* HttpClient.put(`/api/carts/${cartId}/items/1`, {
        body: HttpBody.jsonUnsafe({ quantity: 1 }),
      });
      const response = yield* HttpClient.post(`/api/carts/${cartId}/checkout`);
      assert.strictEqual(response.status, 201);
    }),
  );

const generate = HttpClient.post("/api/admin/coupons/generate");

const listCoupons = HttpClient.get("/api/admin/coupons").pipe(
  Effect.flatMap((response) => response.json),
  Effect.map((coupons) => coupons as ReadonlyArray<CouponBody>),
);

it.effect(
  "five concurrent generate requests at one eligible milestone issue exactly one coupon",
  () =>
    Effect.gen(function* () {
      yield* placeOrders(5);

      const responses = yield* Effect.all(
        Array.from({ length: 5 }, () => generate),
        {
          concurrency: "unbounded",
        },
      );

      const issued = responses.filter((response) => response.status === 201);
      const refused = responses.filter((response) => response.status === 409);
      assert.strictEqual(issued.length, 1);
      assert.strictEqual(refused.length, 4);
      for (const response of refused) {
        assert.deepStrictEqual<unknown>(yield* response.json, {
          code: "NO_ELIGIBLE_MILESTONE",
          message: "Order 10 is the next milestone; 5 orders have been placed",
          details: { orderCount: 5, nextMilestoneOrderCount: 10 },
        });
      }

      const coupon = (yield* issued[0]!.json) as CouponBody;
      assert.match(coupon.code, COUPON_CODE);
      assert.isFalse(Number.isNaN(Date.parse(coupon.createdAt)));
      assert.deepStrictEqual<unknown>(coupon, {
        code: coupon.code,
        milestoneOrderCount: 5,
        discountPercent: 10,
        status: "AVAILABLE",
        createdAt: coupon.createdAt,
        redeemedOrderId: null,
        redeemedAt: null,
      });
      assert.deepStrictEqual<unknown>(yield* listCoupons, [coupon]);

      yield* placeOrders(4);
      const early = yield* generate;
      assert.strictEqual(early.status, 409);
      const error = (yield* early.json) as { code: string; details: unknown };
      assert.strictEqual(error.code, "NO_ELIGIBLE_MILESTONE");
      assert.deepStrictEqual(error.details, { orderCount: 9, nextMilestoneOrderCount: 10 });
      assert.strictEqual((yield* listCoupons).length, 1);
    }).pipe(Effect.provide(TestApi)),
);

it.effect("with two milestones skipped, each request issues the oldest unrewarded one", () =>
  Effect.gen(function* () {
    yield* placeOrders(10);

    const first = yield* generate;
    const second = yield* generate;
    const third = yield* generate;

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);
    const firstCoupon = (yield* first.json) as CouponBody;
    const secondCoupon = (yield* second.json) as CouponBody;
    assert.strictEqual(firstCoupon.milestoneOrderCount, 5);
    assert.strictEqual(secondCoupon.milestoneOrderCount, 10);
    assert.notStrictEqual(firstCoupon.code, secondCoupon.code);

    assert.strictEqual(third.status, 409);
    const error = (yield* third.json) as { code: string; details: unknown };
    assert.strictEqual(error.code, "NO_ELIGIBLE_MILESTONE");
    assert.deepStrictEqual(error.details, { orderCount: 10, nextMilestoneOrderCount: 15 });

    assert.deepStrictEqual<unknown>(yield* listCoupons, [secondCoupon, firstCoupon]);
  }).pipe(Effect.provide(TestApi)),
);
