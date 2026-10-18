import { useAdminReportGetReport } from "@/api/generated/admin-report/admin-report";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";
import { Figure } from "./Figure";

/** The read-only report. The API computes it on every request, so refetching is free. */
export const ReportPanel = () => {
  const report = useAdminReportGetReport();

  if (report.isError) {
    return <p className="text-destructive">Could not load the report: {report.error.message}</p>;
  }
  if (report.data === undefined) {
    return <Skeleton className="h-40" />;
  }
  const { coupons } = report.data;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Orders" value={String(report.data.orderCount)} />
        <Figure label="Gross revenue" value={formatCents(report.data.grossRevenueCents)} />
        <Figure label="Discounts" value={formatCents(-report.data.totalDiscountsCents)} />
        <Figure label="Net revenue" value={formatCents(report.data.netRevenueCents)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Coupons: {coupons.generated} generated, {coupons.available} available, {coupons.redeemed}{" "}
        redeemed
      </p>
      {report.data.products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products sold yet.</p>
      ) : (
        <ul>
          {report.data.products.map((sales) => (
            <li
              key={sales.productId}
              className="flex justify-between border-b py-2 text-sm last:border-b-0"
            >
              <span>{sales.productName}</span>
              <span className="tabular-nums">{sales.purchasedQuantity} sold</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
