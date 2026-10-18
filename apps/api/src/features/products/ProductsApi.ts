import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { AdminAuth } from "../../shared/admin.ts";
import { errorFields } from "../../shared/errors.ts";
import { Cents } from "../../shared/money.ts";

export const ProductId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
  identifier: "ProductId",
});
export type ProductId = typeof ProductId.Type;

export const Inventory = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Product = Schema.Struct({
  id: ProductId,
  name: Schema.String,
  unitPriceCents: Cents,
  availableInventory: Inventory,
}).annotate({ identifier: "Product" });
export type Product = typeof Product.Type;

export class ProductNotFound extends Schema.Error<ProductNotFound>("ProductNotFound")(
  errorFields("PRODUCT_NOT_FOUND", Schema.Struct({ productId: Schema.Int })),
  { httpApiStatus: 404, description: "No product has the given id." },
) {}

export const productNotFound = (productId: ProductId) =>
  new ProductNotFound({
    message: `Product ${productId} does not exist`,
    details: { productId },
  });

export const ShortLine = Schema.Struct({
  productId: ProductId,
  requestedQuantity: Schema.Int,
  availableInventory: Inventory,
}).annotate({ identifier: "ShortLine" });
export type ShortLine = typeof ShortLine.Type;

export class InsufficientInventory extends Schema.Error<InsufficientInventory>(
  "InsufficientInventory",
)(errorFields("INSUFFICIENT_INVENTORY", Schema.Struct({ lines: Schema.Array(ShortLine) })), {
  httpApiStatus: 409,
  description: "A requested quantity exceeds the product's available inventory.",
}) {}

/** Lists every short line, so the client can fix them all at once. */
export const insufficientInventory = (lines: ReadonlyArray<ShortLine>) =>
  new InsufficientInventory({
    message: `Not enough inventory for ${lines.length} ${lines.length === 1 ? "product" : "products"}`,
    details: { lines },
  });

/** Both fields are absolute values; at least one must be present. */
export const ProductUpdate = Schema.Struct({
  unitPriceCents: Schema.optionalKey(Cents),
  availableInventory: Schema.optionalKey(Inventory),
})
  .check(
    Schema.isMinProperties(1, { message: "Provide unitPriceCents, availableInventory, or both" }),
  )
  .annotate({ identifier: "ProductUpdate" });
export type ProductUpdate = typeof ProductUpdate.Type;

export class ProductsApi extends HttpApiGroup.make("products")
  .add(
    HttpApiEndpoint.get("listProducts", "/products", {
      success: Schema.Array(Product),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List products",
        description: "Every product with its current unit price and available inventory.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Products" })) {}

export class AdminProductsApi extends HttpApiGroup.make("adminProducts")
  .add(
    HttpApiEndpoint.patch("updateProduct", "/products/:id", {
      params: { id: ProductId },
      payload: ProductUpdate,
      success: Product,
      error: ProductNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Update a product",
        description:
          "Sets the unit price and/or the available inventory. Both are absolute values, not deltas.",
      }),
    ),
  )
  .prefix("/admin")
  .middleware(AdminAuth)
  .annotateMerge(OpenApi.annotations({ title: "Admin: products" })) {}
