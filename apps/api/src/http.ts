import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api } from "./Api.ts";
import { ProductsHandlers } from "./features/products/products.http.ts";
import { AdminAuthLive } from "./shared/admin.ts";
import { RequestValidationLive } from "./shared/errors.ts";

/**
 * Every route the service serves: the API, its OpenAPI document and the
 * interactive docs. Requires a `SqlClient`; the server and the tests each
 * provide one through `Database.layer`.
 */
// Handler groups capture the API-wide middleware when they are built, so the
// middleware is provided to them rather than to the router.
const Handlers = Layer.mergeAll(ProductsHandlers).pipe(
  Layer.provideMerge(Layer.mergeAll(RequestValidationLive, AdminAuthLive)),
);

export const ApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(Layer.provide(Handlers)),
  HttpApiScalar.layer(Api, { path: "/api/docs" }),
);
