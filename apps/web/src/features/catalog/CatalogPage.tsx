import type { Product } from "@/api/generated/model";
import { useProductsListProducts } from "@/api/generated/products/products";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/money";

const LIMITED_STOCK = 5;

const StockBadge = ({ available }: { readonly available: number }) => {
  if (available === 0) return <Badge variant="destructive">Sold out</Badge>;
  if (available <= LIMITED_STOCK) return <Badge variant="secondary">Only {available} left</Badge>;
  return <Badge variant="outline">{available} in stock</Badge>;
};

const ProductCard = ({ product }: { readonly product: Product }) => (
  <Card>
    <CardHeader>
      <CardTitle>{product.name}</CardTitle>
    </CardHeader>
    <CardContent className="flex items-center justify-between">
      <span className="text-lg font-semibold tabular-nums">
        {formatCents(product.unitPriceCents)}
      </span>
      <StockBadge available={product.availableInventory} />
    </CardContent>
  </Card>
);

export const CatalogPage = () => {
  const products = useProductsListProducts();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Products</h1>
      {products.isError ? (
        <p className="text-destructive">Could not load products: {products.error.message}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.data === undefined
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32" />)
            : products.data.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </main>
  );
};
