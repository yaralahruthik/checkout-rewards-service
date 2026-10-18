import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ProductSales, Report } from "./ReportApi.ts";

/** The totals, repeated on every row, beside one product's sales (null when nothing sold). */
const ReportRow = Schema.Struct({
  orderCount: Schema.Int,
  grossRevenueCents: Schema.Int,
  totalDiscountsCents: Schema.Int,
  netRevenueCents: Schema.Int,
  couponsGenerated: Schema.Int,
  couponsAvailable: Schema.Int,
  couponsRedeemed: Schema.Int,
  productId: Schema.NullOr(ProductSales.fields.productId),
  productName: Schema.NullOr(Schema.String),
  purchasedQuantity: Schema.NullOr(Schema.Int),
});

export class ReportRepository extends Context.Service<
  ReportRepository,
  {
    /** Aggregates the orders, line snapshots and coupons as of one point in time. Writes nothing. */
    readonly get: Effect.Effect<Report>;
  }
>()("api/report/ReportRepository") {
  static readonly layer = Layer.effect(
    ReportRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // One statement reads one snapshot, on SQLite and on Postgres under READ
      // COMMITTED alike, so a checkout committing mid-report cannot be counted
      // in the totals but not the products. It needs no transaction, and so
      // takes no write lock. The single totals row is joined to every product
      // row; LEFT JOIN keeps it when nothing has sold.
      const rows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ReportRow,
        execute: () => sql`
          SELECT totals.*, sold.product_id, sold.product_name, sold.purchased_quantity
          FROM (
            SELECT COUNT(*) AS order_count,
                   COALESCE(SUM(subtotal_cents), 0) AS gross_revenue_cents,
                   COALESCE(SUM(discount_cents), 0) AS total_discounts_cents,
                   COALESCE(SUM(total_cents), 0) AS net_revenue_cents,
                   (SELECT COUNT(*) FROM coupons) AS coupons_generated,
                   (SELECT COUNT(*) FROM coupons WHERE redeemed_order_id IS NULL)
                     AS coupons_available,
                   (SELECT COUNT(redeemed_order_id) FROM coupons) AS coupons_redeemed
            FROM orders
          ) AS totals
          LEFT JOIN (
            SELECT product_id, SUM(quantity) AS purchased_quantity,
                   (SELECT latest.product_name
                    FROM order_lines AS latest JOIN orders ON orders.id = latest.order_id
                    WHERE latest.product_id = lines.product_id
                    ORDER BY orders.created_at DESC, orders.rowid DESC LIMIT 1) AS product_name
            FROM order_lines AS lines GROUP BY product_id
          ) AS sold ON TRUE
          ORDER BY sold.product_id
        `,
      });

      const get = Effect.gen(function* () {
        const report = yield* rows();
        // An aggregate without GROUP BY always returns its row.
        const totals = report[0]!;
        return {
          orderCount: totals.orderCount,
          grossRevenueCents: totals.grossRevenueCents,
          totalDiscountsCents: totals.totalDiscountsCents,
          netRevenueCents: totals.netRevenueCents,
          coupons: {
            generated: totals.couponsGenerated,
            available: totals.couponsAvailable,
            redeemed: totals.couponsRedeemed,
          },
          products: report.flatMap(({ productId, productName, purchasedQuantity }) =>
            productId === null || productName === null || purchasedQuantity === null
              ? []
              : [{ productId, productName, purchasedQuantity }],
          ),
        };
      }).pipe(Effect.orDie, Effect.withSpan("ReportRepository.get"));

      return ReportRepository.of({ get });
    }),
  );
}
