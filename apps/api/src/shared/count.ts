import { Schema } from "effect";

/** A whole number of things (orders, coupons, units): never negative. */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
