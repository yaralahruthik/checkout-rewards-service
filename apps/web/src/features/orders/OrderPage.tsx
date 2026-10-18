import type { ApiError } from "@/api/fetcher";
import type { Order } from "@/api/generated/model";
import { useOrdersGetOrder } from "@/api/generated/orders/orders";
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

/** The order as placed: line snapshots and how the total was calculated. */
export const OrderPage = ({ orderId }: { readonly orderId: string }) => {
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
              <TotalRow label="Discount" cents={-order.data.discountCents} />
              <TotalRow label="Total" cents={order.data.totalCents} strong />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Names and prices are as they were at checkout, even if the catalog has changed since.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
};
