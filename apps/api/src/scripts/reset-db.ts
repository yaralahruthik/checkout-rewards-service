import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { AppConfig } from "../shared/config.ts";
import * as Database from "../shared/db/Database.ts";

Effect.gen(function* () {
  yield* Database.reset;
  const { databasePath } = yield* AppConfig;
  yield* Effect.logInfo(`Reset ${databasePath} to the seeded state`);
}).pipe(
  Effect.provide(Database.layerFromConfig.pipe(Layer.provideMerge(AppConfig.layer))),
  NodeRuntime.runMain,
);
