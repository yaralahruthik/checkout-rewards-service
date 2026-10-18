import type { Product } from "@/api/generated/model";
import { useProductsListProducts } from "@/api/generated/products/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type CartHandle, useCart } from "@/features/cart/useCart";
import { formatCents } from "@/lib/money";

const LIMITED_STOCK = 5;

const StockBadge = ({ available }: { readonly available: number }) => {
  if (available === 0) return <Badge variant="destructive">Sold out</Badge>;
  if (available <= LIMITED_STOCK) return <Badge variant="secondary">Only {available} left</Badge>;
  return <Badge variant="outline">{available} in stock</Badge>;
};

const ProductCard = ({
  product,
  cart,
}: {
  readonly product: Product;
  readonly cart: CartHandle;
}) => {
  const inCart = cart.quantityOf(product.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold tabular-nums">
            {formatCents(product.unitPriceCents)}
          </span>
          <StockBadge available={product.availableInventory} />
        </div>
        {/* Sends the new absolute quantity, so a retried request cannot add twice. */}
        <Button
          variant="outline"
          disabled={cart.isPending}
          onClick={() => void cart.setQuantity(product.id, inCart + 1)}
        >
          {inCart === 0 ? "Add to cart" : `Add another (${inCart} in cart)`}
        </Button>
      </CardContent>
    </Card>
  );
};

export const CatalogPage = () => {
  const products = useProductsListProducts();
  const cart = useCart();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Products</h1>
      {products.isError ? (
        <p className="text-destructive">Could not load products: {products.error.message}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.data === undefined
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32" />)
            : products.data.map((product) => (
                <ProductCard key={product.id} product={product} cart={cart} />
              ))}
        </div>
      )}
    </main>
  );
};
