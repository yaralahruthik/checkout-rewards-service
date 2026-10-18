import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, String } from "effect";
import { SqlClient } from "effect/sql";
import { AppConfig } from "../config.ts";
import createProducts from "./migrations/0001_create_products.ts";
import { seed } from "./seed.ts";

const migrations = SqliteMigrator.fromRecord({
  "0001_create_products": createProducts,
});

const migrateAndSeed = SqliteMigrator.run({ loader: migrations }).pipe(Effect.andThen(seed));

const client = (filename: string) =>
  SqliteClient.layer({
    filename,
    // Columns are snake_case in SQL and camelCase in TypeScript.
    transformQueryNames: String.camelToSnake,
    transformResultNames: String.snakeToCamel,
  });

/**
 * A `SqlClient` for the given SQLite file, with migrations run and the seed
 * applied. The server and the tests (`:memory:`) both use this layer.
 */
export const layer = (options: { readonly filename: string }) =>
  Layer.effectDiscard(migrateAndSeed).pipe(
    Layer.provideMerge(
      Layer.unwrap(
        Effect.sync(() => {
          if (options.filename !== ":memory:") {
            mkdirSync(dirname(options.filename), { recursive: true });
          }
          return client(options.filename);
        }),
      ),
    ),
  );

/** The database at `DATABASE_PATH`. */
export const layerFromConfig = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return layer({ filename: config.databasePath });
  }),
);

/**
 * Drops every table and re-runs migrations and the seed, restoring the seeded
 * state. Used by the `db:reset` command.
 */
export const reset = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `;
  yield* sql`PRAGMA foreign_keys = OFF`;
  for (const { name } of tables) {
    yield* sql`DROP TABLE ${sql(name)}`;
  }
  yield* sql`PRAGMA foreign_keys = ON`;
  yield* migrateAndSeed;
});
