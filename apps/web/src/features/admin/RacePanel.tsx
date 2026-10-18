import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/api/fetcher";
import { adminProductsUpdateProduct } from "@/api/generated/admin-products/admin-products";
import { cartsCreateCart, cartsSetItemQuantity } from "@/api/generated/carts/carts";
import { checkoutCheckout } from "@/api/generated/checkout/checkout";
import {
  getProductsListProductsQueryKey,
  productsListProducts,
} from "@/api/generated/products/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Figure } from "./Figure";

/** "Limited Edition Keycap Set", the seeded stock-3 product (see the API seed). */
const LIMITED_PRODUCT_ID = 6;

interface RaceSettings {
  readonly checkouts: number;
  readonly startingStock: number;
}

interface RaceTally {
  readonly startingStock: number;
  readonly succeeded: number;
  readonly rejected: number;
  /** Any failure other than INSUFFICIENT_INVENTORY, counted by error code. */
  readonly otherErrors: Readonly<Record<string, number>>;
  readonly finalInventory: number;
}

const errorCode = (error: unknown) => (error instanceof ApiError ? error.body.code : "UNKNOWN");

/**
 * Resets the product's stock, fills one fresh cart per checkout with a single
 * unit, then fires every checkout at once. Setup runs before the race, so a
 * setup failure aborts the run instead of being counted as a checkout outcome.
 */
const race = async ({ checkouts, startingStock }: RaceSettings): Promise<RaceTally> => {
  const productId = String(LIMITED_PRODUCT_ID);
  const product = await adminProductsUpdateProduct(productId, {
    availableInventory: startingStock,
  });
  const cartIds = await Promise.all(
    Array.from({ length: checkouts }, async () => {
      const cart = await cartsCreateCart();
      await cartsSetItemQuantity(cart.id, productId, { quantity: 1 });
      return cart.id;
    }),
  );

  const outcomes = await Promise.allSettled(
    cartIds.map((id) => checkoutCheckout(id, { expectedSubtotalCents: product.unitPriceCents })),
  );

  let succeeded = 0;
  let rejected = 0;
  const otherErrors: Record<string, number> = {};
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      succeeded++;
    } else {
      const code = errorCode(outcome.reason);
      if (code === "INSUFFICIENT_INVENTORY") rejected++;
      else otherErrors[code] = (otherErrors[code] ?? 0) + 1;
    }
  }

  const products = await productsListProducts();
  const final = products.find((p) => p.id === LIMITED_PRODUCT_ID);
  if (final === undefined)
    throw new Error(`Product ${LIMITED_PRODUCT_ID} is missing after the race`);

  return {
    startingStock,
    succeeded,
    rejected,
    otherErrors,
    finalInventory: final.availableInventory,
  };
};

const Tally = ({ tally }: { readonly tally: RaceTally }) => {
  const other = Object.entries(tally.otherErrors);
  const otherCount = other.reduce((sum, [, count]) => sum + count, 0);
  const expected = tally.startingStock - tally.succeeded;
  const holds = tally.finalInventory === expected && tally.finalInventory >= 0;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Succeeded" value={tally.succeeded} />
        <Figure label="INSUFFICIENT_INVENTORY" value={tally.rejected} />
        <Figure label="Other errors" value={otherCount} />
        <Figure label="Final inventory" value={tally.finalInventory} />
      </div>
      {other.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {other.map(([code, count]) => `${code} × ${count}`).join(", ")}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={holds ? "secondary" : "destructive"}>{holds ? "Holds" : "Violated"}</Badge>
        Final inventory {tally.finalInventory}, expected {tally.startingStock} − {tally.succeeded} ={" "}
        {expected}, never below zero.
      </p>
    </div>
  );
};

const isCount = (value: string, min: number) =>
  value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= min;

/**
 * The no-oversell demonstration: many parallel checkouts from fresh carts
 * against the limited-stock product. A demonstration, not a test: the race
 * tests in the API are what guard the invariant.
 */
export const RacePanel = () => {
  const queryClient = useQueryClient();
  const [checkouts, setCheckouts] = useState("10");
  const [startingStock, setStartingStock] = useState("3");
  // The query client refreshes the admin views on success; the stock shown
  // in the product editor changes on success and on failure alike. Never
  // retried: a retry would reset the stock and fire another round of orders.
  const run = useMutation<RaceTally, ApiError, RaceSettings>({
    mutationFn: race,
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: getProductsListProductsQueryKey() }),
  });

  // Every cart must hold one unit, which the cart refuses when stock is zero.
  const valid = isCount(checkouts, 1) && isCount(startingStock, 1);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run.mutate({ checkouts: Number(checkouts), startingStock: Number(startingStock) });
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Sets the Limited Edition Keycap Set to the starting stock, puts one unit in each of N new
        carts, and checks them all out at once.
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="race-checkouts">Parallel checkouts</Label>
          <Input
            id="race-checkouts"
            type="number"
            min={1}
            className="w-32"
            value={checkouts}
            onChange={(event) => setCheckouts(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="race-stock">Starting stock</Label>
          <Input
            id="race-stock"
            type="number"
            min={1}
            className="w-32"
            value={startingStock}
            onChange={(event) => setStartingStock(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!valid || run.isPending}>
          {run.isPending ? "Racing…" : "Race it"}
        </Button>
      </form>
      {run.isError && (
        <p className="text-sm text-destructive">
          Race failed, {errorCode(run.error)}: {run.error.message}
        </p>
      )}
      {run.isSuccess && <Tally tally={run.data} />}
    </div>
  );
};
