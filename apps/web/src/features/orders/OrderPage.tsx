import { toast } from "sonner";
import type { ApiError } from "@/api/fetcher";
import { useCheckoutCheckout } from "@/api/generated/checkout/checkout";
import type { Order } from "@/api/generated/model";
import { useOrdersGetOrder } from "@/api/generated/orders/orders";
import { toastApiError } from "@/api/toastApiError";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";

const TotalRow = ({
  label,
  cents,
  strong = false,
}: {
  readonly label: string;
  readonly cents: number;
  readonly strong?: boolean;
}) => (
  <div className={`flex justify-between ${strong ? "text-lg font-semibold" : "text-sm"}`}>
    <span>{label}</span>
    <span className="tabular-nums">{formatCents(cents)}</span>
  </div>
);

/**
 * Sends the cart's checkout again, as a client would after a timeout. The
 * cart is already checked out, so the API replays the order instead of
 * placing a second one.
 */
const RetryCheckout = ({ cartId, order }: { readonly cartId: string; readonly order: Order }) => {
  const retry = useCheckoutCheckout<ApiError>({
    mutation: {
      retry: false,
      onSuccess: (replayed: Order) =>
        replayed.id === order.id
          ? toast.success("The same order came back", {
              description: `Order ${replayed.id} was replayed: no second order, no stock taken.`,
            })
          : toast.error("A different order came back", { description: replayed.id }),
      onError: toastApiError,
    },
  });
  return (
    <Button
      variant="outline"
      disabled={retry.isPending}
      onClick={() =>
        // The same coupon code (or none) as the original, so it replays.
        retry.mutate({
          id: cartId,
          data:
            order.couponCode === null
              ? { expectedSubtotalCents: order.subtotalCents }
              : { expectedSubtotalCents: order.subtotalCents, couponCode: order.couponCode },
        })
      }
    >
      Retry checkout
    </Button>
  );
};

/** The order as placed: line snapshots and how the total was calculated. */
export const OrderPage = ({
  orderId,
  cartId,
}: {
  readonly orderId: string;
  readonly cartId?: string | undefined;
}) => {
  const order = useOrdersGetOrder<Order, ApiError>(orderId, { query: { retry: false } });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Order</h1>
      {order.error ? (
        <p className="text-destructive">Could not load the order: {order.error.message}</p>
      ) : order.data === undefined ? (
        <Skeleton className="h-48" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm">{order.data.id}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Placed {new Date(order.data.createdAt).toLocaleString()}
            </p>
          </CardHeader>
          <CardContent>
            {order.data.lines.map((line) => (
              <div
                key={line.productId}
                className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
              >
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{line.productName}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {line.quantity} × {formatCents(line.unitPriceCents)}
                  </p>
                </div>
                <span className="w-24 text-right font-medium tabular-nums">
                  {formatCents(line.lineTotalCents)}
                </span>
              </div>
            ))}
            <div className="grid gap-1 pt-4">
              <TotalRow label="Subtotal" cents={order.data.subtotalCents} />
              <TotalRow
                label={
                  order.data.couponCode === null
                    ? "Discount"
                    : `Discount (${order.data.couponCode}, ${order.data.discountPercent}% off)`
                }
                cents={-order.data.discountCents}
              />
              <TotalRow label="Total" cents={order.data.totalCents} strong />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Names and prices are as they were at checkout, even if the catalog has changed since.
            </p>
            {cartId !== undefined && (
              <div className="flex justify-end pt-4">
                <RetryCheckout cartId={cartId} order={order.data} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
};
