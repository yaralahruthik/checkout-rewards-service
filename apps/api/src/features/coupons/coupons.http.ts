import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { CouponService } from "./CouponService.ts";

const AdminCouponsGroup = HttpApiBuilder.group(
  Api,
  "adminCoupons",
  Effect.fn("AdminCouponsHandlers")(function* (handlers) {
    const coupons = yield* CouponService;
    return handlers
      .handle("generateCoupon", () => coupons.generate)
      .handle("listCoupons", () => coupons.list);
  }),
);

export const CouponsHandlers = AdminCouponsGroup.pipe(Layer.provide(CouponService.layer));
