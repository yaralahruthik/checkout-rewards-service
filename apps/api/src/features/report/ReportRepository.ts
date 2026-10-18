import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ProductSales, Report } from "./ReportApi.ts";

const Totals = Schema.Struct({
  orderCount: Schema.Int,
  grossRevenueCents: Schema.Int,
  totalDiscountsCents: Schema.Int,
  netRevenueCents: Schema.Int,
  couponsGenerated: Schema.Int,
  couponsAvailable: Schema.Int,
  couponsRedeemed: Schema.Int,
});

export class ReportRepository extends Context.Service<
  ReportRepository,
  {
    /** Aggregates the orders, line snapshots and coupons as of one point in time. Writes nothing. */
    readonly read: Effect.Effect<Report>;
  }
>()("api/report/ReportRepository") {
  static readonly layer = Layer.effect(
    ReportRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const totals = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Totals,
        execute: () => sql`
          SELECT COUNT(*) AS order_count,
                 COALESCE(SUM(subtotal_cents), 0) AS gross_revenue_cents,
                 COALESCE(SUM(discount_cents), 0) AS total_discounts_cents,
                 COALESCE(SUM(total_cents), 0) AS net_revenue_cents,
                 (SELECT COUNT(*) FROM coupons) AS coupons_generated,
                 (SELECT COUNT(*) FROM coupons WHERE redeemed_order_id IS NULL)
                   AS coupons_available,
                 (SELECT COUNT(redeemed_order_id) FROM coupons) AS coupons_redeemed
          FROM orders
        `,
      });

      const products = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ProductSales,
        execute: () => sql`
          SELECT product_id, SUM(quantity) AS purchased_quantity
          FROM order_lines GROUP BY product_id ORDER BY product_id
        `,
      });

      // Two statements, one transaction: a checkout committing between them
      // would otherwise count its lines but not its order.
      const read = sql
        .withTransaction(
          Effect.gen(function* () {
            const { couponsGenerated, couponsAvailable, couponsRedeemed, ...revenue } =
              yield* totals();
            return {
              ...revenue,
              coupons: {
                generated: couponsGenerated,
                available: couponsAvailable,
                redeemed: couponsRedeemed,
              },
              products: yield* products(),
            };
          }),
        )
        .pipe(Effect.orDie, Effect.withSpan("ReportRepository.read"));

      return ReportRepository.of({ read });
    }),
  );
}
