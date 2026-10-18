import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Coupon } from "./CouponsApi.ts";

/** A coupon to issue; the repository decides which milestone it rewards. */
export type NewCoupon = {
  readonly code: string;
  readonly discountPercent: number;
  readonly createdAt: string;
};

const MilestoneProgress = Schema.Struct({
  orderCount: Schema.Int,
  nextMilestoneOrderCount: Schema.Int,
});

export class CouponRepository extends Context.Service<
  CouponRepository,
  {
    /**
     * Inserts the coupon for the next milestone, (coupons + 1) × `milestoneInterval`,
     * in one statement guarded by the order count having reached it. `None`
     * when it has not, or when a concurrent request already issued it.
     */
    readonly issueNext: (
      coupon: NewCoupon,
      milestoneInterval: number,
    ) => Effect.Effect<Option.Option<Coupon>>;
    /** Successful orders placed, and the milestone the next coupon would reward. */
    readonly progress: (milestoneInterval: number) => Effect.Effect<typeof MilestoneProgress.Type>;
    /** Every coupon, newest milestone first. */
    readonly list: Effect.Effect<ReadonlyArray<Coupon>>;
  }
>()("api/coupons/CouponRepository") {
  static readonly layer = Layer.effect(
    CouponRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const columns = sql`
        code, milestone_order_count, discount_percent, created_at,
        CASE WHEN redeemed_order_id IS NULL THEN 'AVAILABLE' ELSE 'REDEEMED' END AS status,
        redeemed_order_id, redeemed_at
      `;

      // The milestone is computed and guarded inside the statement, so no
      // read-then-write gap exists. Two requests that still pick the same
      // milestone (Postgres under READ COMMITTED) collide on its unique
      // constraint, and DO NOTHING turns the loser into "no row".
      const issueNextQuery = SqlSchema.findOneOption({
        Request: Schema.Struct({
          code: Schema.String,
          discountPercent: Schema.Int,
          createdAt: Schema.String,
          milestoneInterval: Schema.Int,
        }),
        Result: Coupon,
        execute: ({ code, discountPercent, createdAt, milestoneInterval }) => sql`
          INSERT INTO coupons (code, milestone_order_count, discount_percent, created_at)
          SELECT ${code}, next.milestone, ${discountPercent}, ${createdAt}
          FROM (SELECT (COUNT(*) + 1) * ${milestoneInterval} AS milestone FROM coupons) AS next
          WHERE (SELECT COUNT(*) FROM orders) >= next.milestone
          ON CONFLICT (milestone_order_count) DO NOTHING
          RETURNING ${columns}
        `,
      });

      const issueNext = Effect.fn("CouponRepository.issueNext")(function* (
        coupon: NewCoupon,
        milestoneInterval: number,
      ) {
        return yield* issueNextQuery({ ...coupon, milestoneInterval });
      }, Effect.orDie);

      // The same milestone expression as the insert above.
      const progressQuery = SqlSchema.findOne({
        Request: Schema.Int,
        Result: MilestoneProgress,
        execute: (milestoneInterval) => sql`
          SELECT (SELECT COUNT(*) FROM orders) AS order_count,
                 (SELECT (COUNT(*) + 1) * ${milestoneInterval} FROM coupons)
                   AS next_milestone_order_count
        `,
      });

      const list = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Coupon,
        execute: () => sql`SELECT ${columns} FROM coupons ORDER BY milestone_order_count DESC`,
      })().pipe(Effect.orDie, Effect.withSpan("CouponRepository.list"));

      return CouponRepository.of({
        issueNext,
        progress: (milestoneInterval) =>
          progressQuery(milestoneInterval).pipe(
            Effect.orDie,
            Effect.withSpan("CouponRepository.progress"),
          ),
        list,
      });
    }),
  );
}
