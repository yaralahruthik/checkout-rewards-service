import { randomUUIDv7 } from "node:crypto";
import { Context, Effect } from "effect";

/**
 * Generates identifiers. A reference with a default, so production code needs
 * no wiring and a test that wants deterministic ids can provide its own.
 */
export const Ids = Context.Reference<{
  /** A UUIDv7: time-ordered, with 74 random bits, so it is unguessable. */
  readonly uuidv7: Effect.Effect<string>;
}>("api/shared/Ids", {
  defaultValue: () => ({ uuidv7: Effect.sync(() => randomUUIDv7()) }),
});
