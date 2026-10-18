import { readFileSync } from "node:fs";
import { assert, it } from "@effect/vitest";
import { OpenApi } from "effect/http-api";
import { Api } from "./Api.ts";

it("the committed openapi.json matches the document generated from the API definition", () => {
  const committed: unknown = JSON.parse(
    readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
  );

  assert.deepStrictEqual(
    committed,
    OpenApi.fromApi(Api),
    "openapi.json is out of date: run `vp run openapi` and commit the result",
  );
});
