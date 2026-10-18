import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { AdminAuth } from "../../shared/admin.ts";
import { errorFields } from "../../shared/errors.ts";
import { DiscountPercent } from "../../shared/money.ts";
import { OrderId } from "../orders/OrdersApi.ts";

export const CouponCode = Schema.String.annotate({
  identifier: "CouponCode",
  description:
    "`SAVE<x>-` followed by 8 Crockford base32 characters, for example `SAVE10-7KQ2M9XA`.",
});

export const CouponStatus = Schema.Literals(["AVAILABLE", "REDEEMED"]).annotate({
  identifier: "CouponStatus",
});
export type CouponStatus = typeof CouponStatus.Type;

const OrderCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Coupon = Schema.Struct({
  code: CouponCode,
  /** The n-th order whose milestone this coupon rewards. */
  milestoneOrderCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** Snapshotted from the configuration when the coupon was generated. */
  discountPercent: DiscountPercent,
  status: CouponStatus,
  createdAt: Schema.String.annotate({
    description: "When the coupon was generated (ISO 8601, UTC).",
  }),
  redeemedOrderId: Schema.NullOr(OrderId),
  redeemedAt: Schema.NullOr(
    Schema.String.annotate({ description: "When the coupon was redeemed (ISO 8601, UTC)." }),
  ),
}).annotate({
  identifier: "Coupon",
  description:
    "A bearer coupon: anyone holding the code can redeem it once. It never expires, and its percent never changes after generation.",
});
export type Coupon = typeof Coupon.Type;

export class NoEligibleMilestone extends Schema.Error<NoEligibleMilestone>("NoEligibleMilestone")(
  errorFields(
    "NO_ELIGIBLE_MILESTONE",
    Schema.Struct({ orderCount: OrderCount, nextMilestoneOrderCount: OrderCount }),
  ),
  {
    httpApiStatus: 409,
    description:
      "Every milestone reached so far already has its coupon. `nextMilestoneOrderCount` is the order count at which the next one becomes available.",
  },
) {}

export const noEligibleMilestone = (details: NoEligibleMilestone["details"]) =>
  new NoEligibleMilestone({
    message: `Order ${details.nextMilestoneOrderCount} is the next milestone; ${details.orderCount} ${details.orderCount === 1 ? "order has" : "orders have"} been placed`,
    details,
  });

export class AdminCouponsApi extends HttpApiGroup.make("adminCoupons")
  .add(
    HttpApiEndpoint.post("generateCoupon", "/coupons/generate", {
      success: Coupon.pipe(HttpApiSchema.status(201)),
      error: NoEligibleMilestone,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Generate a coupon",
        description:
          "Issues one coupon for the oldest milestone that has been reached but not rewarded. Every n-th successful order is a milestone. Safe to repeat and to call concurrently: each milestone gets exactly one coupon, and every other request is refused.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("listCoupons", "/coupons", {
      success: Schema.Array(Coupon),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List coupons",
        description: "Every coupon with its status, newest milestone first.",
      }),
    ),
  )
  .prefix("/admin")
  .middleware(AdminAuth)
  .annotateMerge(OpenApi.annotations({ title: "Admin: coupons" })) {}
