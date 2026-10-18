import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { AdminAuth } from "../../shared/admin.ts";
import { errorFields } from "../../shared/errors.ts";
import { Cents } from "../../shared/money.ts";

export const ProductId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
  identifier: "ProductId",
});

const Inventory = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

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

/** Both fields are absolute values; at least one must be present. */
export const ProductUpdate = Schema.Struct({
  unitPriceCents: Schema.optionalKey(Cents),
  inventory: Schema.optionalKey(Inventory),
})
  .check(Schema.isMinProperties(1, { message: "Provide unitPriceCents, inventory, or both" }))
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
