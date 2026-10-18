import { MutationCache, QueryClient } from "@tanstack/react-query";
import { getAdminCouponsListCouponsQueryKey } from "@/api/generated/admin-coupons/admin-coupons";
import { getAdminOrdersListOrdersQueryKey } from "@/api/generated/admin-orders/admin-orders";
import { getAdminReportGetReportQueryKey } from "@/api/generated/admin-report/admin-report";

/** Read from orders and coupons, so any successful write can change them. */
const adminDataKeys = [
  getAdminReportGetReportQueryKey(),
  getAdminOrdersListOrdersQueryKey(),
  getAdminCouponsListCouponsQueryKey(),
];

/**
 * The one place that keeps the admin views current: every successful mutation
 * (checkout, coupon generation, product edits) marks them stale. Queries on
 * screen refetch at once; the rest refetch when next shown.
 */
export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () =>
      Promise.all(adminDataKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  }),
});
