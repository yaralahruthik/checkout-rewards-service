import type { ReactNode } from "react";

/** One labelled number in a row of admin figures. */
export const Figure = ({ label, value }: { readonly label: string; readonly value: ReactNode }) => (
  <div className="rounded-md border p-3">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold tabular-nums">{value}</p>
  </div>
);
