import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Cents } from "../../shared/money.ts";

export const ProductId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
  identifier: "ProductId",
});

export const Product = Schema.Struct({
  id: ProductId,
  name: Schema.String,
  unitPriceCents: Cents,
  availableInventory: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "Product" });
export type Product = typeof Product.Type;

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
