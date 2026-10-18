import { Context, DateTime, Effect, Layer, Option } from "effect";
import { AppConfig } from "../../shared/config.ts";
import { Ids } from "../../shared/ids.ts";
import { Coupon, NoEligibleMilestone, noEligibleMilestone } from "./CouponsApi.ts";
import { CouponRepository } from "./CouponRepository.ts";

export class CouponService extends Context.Service<
  CouponService,
  {
    readonly generate: Effect.Effect<Coupon, NoEligibleMilestone>;
    readonly list: Effect.Effect<ReadonlyArray<Coupon>>;
  }
>()("api/coupons/CouponService") {
  static readonly layer = Layer.effect(
    CouponService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const repository = yield* CouponRepository;

      const generate = Effect.gen(function* () {
        const ids = yield* Ids;
        const { discountPercent, milestoneInterval } = config;
        const coupon = yield* repository.issueNext(
          {
            code: `SAVE${discountPercent}-${yield* ids.crockfordBase32(8)}`,
            discountPercent,
            createdAt: DateTime.formatIso(yield* DateTime.now),
          },
          milestoneInterval,
        );
        if (Option.isSome(coupon)) {
          return coupon.value;
        }
        // Read after the refusal, so a request that lost a race reports the
        // milestone after the one the winner took.
        return yield* noEligibleMilestone(yield* repository.progress(milestoneInterval));
      }).pipe(Effect.withSpan("CouponService.generate"));

      return CouponService.of({ generate, list: repository.list });
    }),
  ).pipe(Layer.provide(CouponRepository.layer));
}
