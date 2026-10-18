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
