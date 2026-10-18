import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAdminProductsUpdateProduct } from "@/api/generated/admin-products/admin-products";
import type { Product, ProductUpdate } from "@/api/generated/model";
import type { ApiError } from "@/api/fetcher";
import {
  getProductsListProductsQueryKey,
  useProductsListProducts,
} from "@/api/generated/products/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";

/**
 * Empty fields are left out of the update. Anything else is sent as typed, so
 * invalid input (negative, fractional) is rejected by the API, not here.
 */
const toUpdate = (price: string, inventory: string): ProductUpdate => ({
  ...(price.trim() === "" ? {} : { unitPriceCents: Number(price) }),
  ...(inventory.trim() === "" ? {} : { availableInventory: Number(inventory) }),
});

const ProductRow = ({ product }: { readonly product: Product }) => {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("");
  // The fetcher throws `ApiError`, not the bare error body orval assumes.
  const update = useAdminProductsUpdateProduct<ApiError>({
    mutation: {
      onSuccess: () => {
        setPrice("");
        setInventory("");
        return queryClient.invalidateQueries({ queryKey: getProductsListProductsQueryKey() });
      },
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ id: String(product.id), data: toUpdate(price, inventory) });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <p className="font-medium">{product.name}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatCents(product.unitPriceCents)} · {product.availableInventory} in stock
          </p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`price-${product.id}`}>Price (cents)</Label>
          <Input
            id={`price-${product.id}`}
            type="number"
            className="w-32"
            placeholder={String(product.unitPriceCents)}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`inventory-${product.id}`}>Inventory</Label>
          <Input
            id={`inventory-${product.id}`}
            type="number"
            className="w-24"
            placeholder={String(product.availableInventory)}
            value={inventory}
            onChange={(event) => setInventory(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
      </div>
      {update.isError && (
        <p className="text-sm text-destructive">
          {update.error.body.code}: {update.error.message}
        </p>
      )}
    </form>
  );
};

export const ProductEditor = () => {
  const products = useProductsListProducts();

  if (products.isError) {
    return <p className="text-destructive">Could not load products: {products.error.message}</p>;
  }
  if (products.data === undefined) {
    return <Skeleton className="h-64" />;
  }
  return (
    <div>
      {products.data.map((product) => (
        <ProductRow key={product.id} product={product} />
      ))}
    </div>
  );
};
