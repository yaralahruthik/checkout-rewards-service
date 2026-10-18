import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { ApiRoutes } from "../http.ts";
import * as Database from "../shared/db/Database.ts";

/**
 * Serves the real API routes in memory against a fresh, migrated and seeded
 * in-memory database, and provides an `HttpClient` that talks to them.
 *
 * Provide it per test (`Effect.provide(TestApi)`) so each test gets its own
 * database. Requests use paths such as `/api/products`.
 */
export const TestApi: Layer.Layer<HttpClient.HttpClient> = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(ApiRoutes);
    return HttpClient.make((request) =>
      handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromClientRequest(request),
        ),
        Effect.map((response) => HttpServerResponse.toClientResponse(response, { request })),
        Effect.scoped,
        Effect.orDie,
      ),
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("http://localhost")));
  }),
).pipe(
  Layer.provide([Database.layer({ filename: ":memory:" }), HttpServer.layerServices]),
  Layer.orDie,
);
