import { useState, type FormEvent } from "react";
import type { CartLine } from "@/api/generated/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";
import { type CartHandle, useCart } from "./useCart";

const CartLineForm = ({ line, cart }: { readonly line: CartLine; readonly cart: CartHandle }) => {
  const [quantity, setQuantity] = useState(String(line.quantity));

  // Sent as typed: the API rejects anything that is not an integer from 1 to 99.
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void cart.setQuantity(line.productId, Number(quantity));
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
    >
      <div className="min-w-48 flex-1">
        <p className="font-medium">{line.productName}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatCents(line.unitPriceCents)} each · {line.availableInventory} in stock
        </p>
        {line.insufficientStock && (
          <Badge variant="destructive" className="mt-1">
            Only {line.availableInventory} left: reduce the quantity before checkout
          </Badge>
        )}
      </div>
      <Input
        aria-label={`Quantity of ${line.productName}`}
        type="number"
        className="w-20"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={cart.isPending}>
        Update
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={cart.isPending}
        onClick={() => cart.remove(line.productId)}
      >
        Remove
      </Button>
      <span className="w-24 text-right font-medium tabular-nums">
        {formatCents(line.lineTotalCents)}
      </span>
    </form>
  );
};

export const CartPage = () => {
  const cart = useCart();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Cart</h1>
      {cart.error ? (
        <p className="text-destructive">Could not load the cart: {cart.error.message}</p>
      ) : cart.isLoading ? (
        <Skeleton className="h-48" />
      ) : cart.data === undefined || cart.data.lines.length === 0 ? (
        <p className="text-muted-foreground">
          Your cart is empty.{" "}
          <a href="#/" className="underline">
            Browse products
          </a>
          .
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {cart.data.itemCount} {cart.data.itemCount === 1 ? "item" : "items"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cart.data.lines.map((line) => (
              // Keyed by quantity too, so the input resets when the server's value changes.
              <CartLineForm key={`${line.productId}:${line.quantity}`} line={line} cart={cart} />
            ))}
            <div className="flex justify-between pt-4 text-lg font-semibold">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCents(cart.data.subtotalCents)}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Prices are live: they reflect the current catalog until you check out.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
};
