import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import type { CartLine } from "@/api/generated/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** Shows the totals checkout found; confirming checks out again with the new subtotal. */
const PriceChangedDialog = ({ cart }: { readonly cart: CartHandle }) => {
  const change = cart.priceChange;
  return (
    <Dialog open={change !== null} onOpenChange={(open) => open || cart.dismissPriceChange()}>
      {change !== null && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prices have changed</DialogTitle>
            <DialogDescription>
              Your subtotal is now {formatCents(change.subtotalCents)}, not{" "}
              {formatCents(change.expectedSubtotalCents)}. Nothing has been charged.
            </DialogDescription>
          </DialogHeader>
          <div>
            {change.lines.map((line) => (
              <div key={line.productId} className="flex justify-between py-1 text-sm">
                <span>
                  {line.productName} · {line.quantity} × {formatCents(line.unitPriceCents)}
                </span>
                <span className="tabular-nums">{formatCents(line.lineTotalCents)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>New subtotal</span>
              <span className="tabular-nums">{formatCents(change.subtotalCents)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cart.dismissPriceChange}>
              Back to cart
            </Button>
            <Button disabled={cart.isPending} onClick={() => cart.checkout(change.subtotalCents)}>
              Check out for {formatCents(change.subtotalCents)}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
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
      ) : cart.data?.orderId !== undefined ? (
        <p className="text-muted-foreground">
          This cart has been checked out.{" "}
          <Link to="/orders/$orderId" params={{ orderId: cart.data.orderId }} className="underline">
            View the order
          </Link>
          .
        </p>
      ) : cart.data === undefined || cart.data.lines.length === 0 ? (
        <p className="text-muted-foreground">
          Your cart is empty.{" "}
          <Link to="/" className="underline">
            Browse products
          </Link>
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
              Prices are live: they reflect the current catalog until you check out. A coupon's
              discount is applied at checkout.
            </p>
            <div className="flex flex-wrap items-end justify-end gap-3 pt-4">
              <div className="grid gap-1">
                <Label htmlFor="coupon-code">Coupon code</Label>
                <Input
                  id="coupon-code"
                  className="w-48 font-mono"
                  placeholder="SAVE10-…"
                  value={cart.couponCode}
                  onChange={(event) => cart.setCouponCode(event.target.value)}
                />
              </div>
              <Button
                disabled={cart.isPending}
                onClick={() => cart.checkout(cart.data!.subtotalCents)}
              >
                Check out
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <PriceChangedDialog cart={cart} />
    </main>
  );
};
