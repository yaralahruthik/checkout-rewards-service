import { Link } from "@tanstack/react-router";
import { useAdminOrdersListOrders } from "@/api/generated/admin-orders/admin-orders";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";

/** Every order, newest first, to reconcile against the report. */
export const OrdersPanel = () => {
  const orders = useAdminOrdersListOrders();

  if (orders.isError) {
    return <p className="text-destructive">Could not load orders: {orders.error.message}</p>;
  }
  if (orders.data === undefined) {
    return <Skeleton className="h-24" />;
  }
  if (orders.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders placed yet.</p>;
  }
  return (
    <ul>
      {orders.data.map((order) => (
        <li
          key={order.id}
          className="flex flex-wrap items-center gap-3 border-b py-2 text-sm last:border-b-0"
        >
          <Link
            to="/orders/$orderId"
            params={{ orderId: order.id }}
            className="font-mono underline-offset-4 hover:underline"
          >
            {order.id}
          </Link>
          <span className="text-muted-foreground">
            {new Date(order.createdAt).toLocaleString()} ·{" "}
            {order.lines.reduce((units, line) => units + line.quantity, 0)} items
            {order.couponCode !== null && ` · ${order.couponCode}`}
          </span>
          <span className="ml-auto font-medium tabular-nums">{formatCents(order.totalCents)}</span>
        </li>
      ))}
    </ul>
  );
};
