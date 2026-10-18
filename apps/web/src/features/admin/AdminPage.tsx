import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouponsPanel } from "./CouponsPanel";
import { OrdersPanel } from "./OrdersPanel";
import { ProductEditor } from "./ProductEditor";
import { RacePanel } from "./RacePanel";
import { ReportPanel } from "./ReportPanel";

const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

/**
 * Administrative operations. The API serves them under `/api/admin` with no
 * authentication (see DECISIONS.md), so this page has no login either.
 */
export const AdminPage = () => (
  <main className="mx-auto grid max-w-5xl gap-6 p-6">
    <h1 className="text-2xl font-semibold">Admin</h1>
    <Section title="Report">
      <ReportPanel />
    </Section>
    <Section title="Products">
      <ProductEditor />
    </Section>
    <Section title="Race it">
      <RacePanel />
    </Section>
    <Section title="Coupons">
      <CouponsPanel />
    </Section>
    <Section title="Orders">
      <OrdersPanel />
    </Section>
  </main>
);
