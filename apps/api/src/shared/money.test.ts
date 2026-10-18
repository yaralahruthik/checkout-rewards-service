import { assert, it } from "@effect/vitest";
import { discountCents, priceLines } from "./money.ts";

it("prices each line at unit price × quantity and sums them, keeping the line's own fields", () => {
  const priced = priceLines([
    { productId: 1, unitPriceCents: 1999, quantity: 3 },
    { productId: 2, unitPriceCents: 250, quantity: 1 },
  ]);

  assert.deepStrictEqual(priced, {
    lines: [
      { productId: 1, unitPriceCents: 1999, quantity: 3, lineTotalCents: 5997 },
      { productId: 2, unitPriceCents: 250, quantity: 1, lineTotalCents: 250 },
    ],
    subtotalCents: 6247,
  });
});

it("an empty cart has no lines and a zero subtotal", () => {
  assert.deepStrictEqual(priceLines([]), { lines: [], subtotalCents: 0 });
});

it("a 10% discount on 1999 cents rounds down to 199", () => {
  assert.strictEqual(discountCents(1999, 10), 199);
});

it("a discount never exceeds the subtotal: 100% leaves a zero total", () => {
  assert.strictEqual(discountCents(1999, 100), 1999);
  assert.strictEqual(discountCents(0, 50), 0);
});
