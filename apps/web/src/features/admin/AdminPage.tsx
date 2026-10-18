import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouponsPanel } from "./CouponsPanel";
import { ProductEditor } from "./ProductEditor";

/**
 * Administrative operations. The API serves them under `/api/admin` with no
 * authentication (see DECISIONS.md), so this page has no login either.
 */
export const AdminPage = () => (
  <main className="mx-auto grid max-w-5xl gap-6 p-6">
    <h1 className="text-2xl font-semibold">Admin</h1>
    <Card>
      <CardHeader>
        <CardTitle>Products</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductEditor />
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>Coupons</CardTitle>
      </CardHeader>
      <CardContent>
        <CouponsPanel />
      </CardContent>
    </Card>
  </main>
);
