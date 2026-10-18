import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { ApiRoutes } from "./http.ts";
import { AppConfig } from "./shared/config.ts";
import * as Database from "./shared/db/Database.ts";

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    yield* Effect.logInfo("Starting API", config);
    return NodeHttpServer.layer(createServer, { port: config.port });
  }),
);

HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide([Server, Database.layerFromConfig]),
  Layer.provide(AppConfig.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
