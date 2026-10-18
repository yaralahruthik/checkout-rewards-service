import { getRandomValues, randomUUIDv7 } from "node:crypto";
import { Context, Effect } from "effect";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates identifiers. A reference with a default, so production code needs
 * no wiring and a test that wants deterministic ids can provide its own.
 */
export const Ids = Context.Reference<{
  /** A UUIDv7: time-ordered, with 74 random bits, so it is unguessable. */
  readonly uuidv7: Effect.Effect<string>;
  /** `length` Crockford base32 characters, 5 cryptographically random bits each. */
  readonly crockfordBase32: (length: number) => Effect.Effect<string>;
}>("api/shared/Ids", {
  defaultValue: () => ({
    uuidv7: Effect.sync(() => randomUUIDv7()),
    crockfordBase32: (length) =>
      Effect.sync(() =>
        // 256 is a multiple of 32, so the low 5 bits of a random byte are uniform.
        Array.from(
          getRandomValues(new Uint8Array(length)),
          (byte) => CROCKFORD_BASE32[byte & 31],
        ).join(""),
      ),
  }),
});
