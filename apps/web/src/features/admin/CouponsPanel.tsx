import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminCouponsListCouponsQueryKey,
  useAdminCouponsGenerateCoupon,
  useAdminCouponsListCoupons,
} from "@/api/generated/admin-coupons/admin-coupons";
import type { ApiError } from "@/api/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const CouponList = () => {
  const coupons = useAdminCouponsListCoupons();

  if (coupons.isError) {
    return <p className="text-destructive">Could not load coupons: {coupons.error.message}</p>;
  }
  if (coupons.data === undefined) {
    return <Skeleton className="h-24" />;
  }
  if (coupons.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No coupons generated yet.</p>;
  }
  return (
    <ul>
      {coupons.data.map((coupon) => (
        <li
          key={coupon.code}
          className="flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0"
        >
          <code className="font-mono font-medium">{coupon.code}</code>
          <span className="text-sm text-muted-foreground">
            {coupon.discountPercent}% off · order #{coupon.milestoneOrderCount}
          </span>
          <Badge
            variant={coupon.status === "AVAILABLE" ? "secondary" : "outline"}
            className="ml-auto"
          >
            {coupon.status === "AVAILABLE" ? "Available" : `Redeemed by ${coupon.redeemedOrderId}`}
          </Badge>
        </li>
      ))}
    </ul>
  );
};

/** Generates the coupon for the oldest unrewarded milestone and lists every coupon. */
export const CouponsPanel = () => {
  const queryClient = useQueryClient();
  // The fetcher throws `ApiError`, not the bare error body orval assumes.
  const generate = useAdminCouponsGenerateCoupon<ApiError>({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getAdminCouponsListCouponsQueryKey() }),
    },
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          Generate coupon
        </Button>
        {generate.isSuccess && (
          <p className="text-sm">
            Issued <code className="font-mono font-medium">{generate.data.code}</code> for order #
            {generate.data.milestoneOrderCount}
          </p>
        )}
        {generate.isError && (
          <p className="text-sm text-destructive">
            {generate.error.body.code}: {generate.error.message}
          </p>
        )}
      </div>
      <CouponList />
    </div>
  );
};
