import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { AdminAuth } from "../../shared/admin.ts";
import { Count } from "../../shared/count.ts";
import { Cents } from "../../shared/money.ts";
import { ProductId } from "../products/ProductsApi.ts";

export const ProductSales = Schema.Struct({
  productId: ProductId,
  productName: Schema.String.annotate({
    description: "The name on the product's most recent order line snapshot.",
  }),
  /** Summed over every order's line snapshots for this product. */
  purchasedQuantity: Count,
}).annotate({ identifier: "ProductSales" });

export const CouponCounts = Schema.Struct({
  generated: Count,
  available: Count,
  redeemed: Count,
}).annotate({
  identifier: "CouponCounts",
  description: "`generated` = `available` + `redeemed`.",
});

export const Report = Schema.Struct({
  orderCount: Count.annotate({ description: "Successfully placed orders." }),
  grossRevenueCents: Cents.annotate({ description: "Sum of the orders' `subtotalCents`." }),
  totalDiscountsCents: Cents.annotate({ description: "Sum of the orders' `discountCents`." }),
  netRevenueCents: Cents.annotate({
    description: "Sum of the orders' `totalCents`: `grossRevenueCents - totalDiscountsCents`.",
  }),
  coupons: CouponCounts,
  products: Schema.Array(ProductSales).annotate({
    description: "Every product bought at least once, by product id.",
  }),
}).annotate({
  identifier: "Report",
  description:
    "Computed on every request from the orders, their line snapshots and the coupons, so it reconciles exactly with `GET /api/admin/orders` and `GET /api/admin/coupons`.",
});
export type Report = typeof Report.Type;

export class AdminReportApi extends HttpApiGroup.make("adminReport")
  .add(
    HttpApiEndpoint.get("getReport", "/report", {
      success: Report,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get the report",
        description:
          "Quantity sold per product, revenue before and after discounts, coupon counts and the order count. Read-only: requesting it never changes any state.",
      }),
    ),
  )
  .prefix("/admin")
  .middleware(AdminAuth)
  .annotateMerge(OpenApi.annotations({ title: "Admin: report" })) {}
