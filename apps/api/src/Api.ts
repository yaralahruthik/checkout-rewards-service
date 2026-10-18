import { HttpApi, OpenApi } from "effect/http-api";
import { CartsApi } from "./features/carts/CartsApi.ts";
import { CheckoutApi } from "./features/checkout/CheckoutApi.ts";
import { AdminCouponsApi } from "./features/coupons/CouponsApi.ts";
import { AdminOrdersApi, OrdersApi } from "./features/orders/OrdersApi.ts";
import { AdminProductsApi, ProductsApi } from "./features/products/ProductsApi.ts";
import { AdminReportApi } from "./features/report/ReportApi.ts";
import { RequestValidation } from "./shared/errors.ts";

/**
 * The API definition: the single source of the OpenAPI document, request
 * validation and error typing. It contains no handlers.
 */
export class Api extends HttpApi.make("checkout-rewards")
  .add(ProductsApi)
  .add(CartsApi)
  .add(CheckoutApi)
  .add(OrdersApi)
  .add(AdminProductsApi)
  .add(AdminCouponsApi)
  .add(AdminOrdersApi)
  .add(AdminReportApi)
  .middleware(RequestValidation)
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Checkout and Rewards API",
      version: "0.1.0",
      description:
        "Carts, idempotent checkout, and milestone coupons. All money is in integer cents (USD).",
    }),
  ) {}
