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
