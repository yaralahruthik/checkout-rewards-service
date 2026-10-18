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

/**
 * Prices lines at the unit prices they carry: each line total is unit price ×
 * quantity, and the subtotal is their sum. All integers, so both are exact.
 * The cart view and checkout both price through here, so the subtotal a
 * shopper saw and the one the price guard compares are computed the same way.
 */
export const priceLines = <
  L extends { readonly unitPriceCents: number; readonly quantity: number },
>(
  lines: ReadonlyArray<L>,
): {
  readonly lines: ReadonlyArray<L & { readonly lineTotalCents: number }>;
  readonly subtotalCents: number;
} => {
  const priced = lines.map((line) => ({
    ...line,
    lineTotalCents: line.unitPriceCents * line.quantity,
  }));
  return {
    lines: priced,
    subtotalCents: priced.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
};

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
