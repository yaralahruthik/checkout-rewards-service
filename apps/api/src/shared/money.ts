import { Schema } from "effect";

/**
 * A non-negative amount of money in integer cents (USD). Every money field in
 * the API uses this schema and is suffixed `Cents`; no floating-point value is
 * ever used on a money path.
 */
export const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  identifier: "Cents",
  description: "An amount of money in integer cents (USD).",
});

/** Unit price × quantity. Both are integers, so the product is exact. */
export const lineTotalCents = (unitPriceCents: number, quantity: number): number =>
  unitPriceCents * quantity;

/** The sum of the line totals. */
export const subtotalCents = (lines: ReadonlyArray<{ readonly lineTotalCents: number }>): number =>
  lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

/**
 * floor(subtotal × percent / 100), clamped to the subtotal so the total is
 * never negative. The floor never over-discounts: 10% of 1999 is 199. The
 * division is exact because the remainder is subtracted first.
 */
export const discountCents = (subtotal: number, percent: number): number => {
  const scaled = subtotal * percent;
  return Math.min(subtotal, (scaled - (scaled % 100)) / 100);
};

/** A coupon's discount: a whole percent from 1 to 100. */
export const DiscountPercent = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));
