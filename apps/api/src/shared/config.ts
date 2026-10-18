import { fileURLToPath } from "node:url";
import { Config, Context, Layer, Schema } from "effect";

const MilestoneInterval = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
// Resolved against the API package, not the working directory.
const defaultDatabasePath = fileURLToPath(new URL("../../data/store.db", import.meta.url));

const DiscountPercent = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

/**
 * Startup configuration, read from the environment and validated before the
 * server starts. An invalid value fails the layer, so the process exits.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    /** `n`: every n-th successful order makes one coupon available. */
    readonly milestoneInterval: number;
    /** `x`: the percentage discount a generated coupon grants. */
    readonly discountPercent: number;
    readonly databasePath: string;
    readonly port: number;
  }
>()("api/shared/AppConfig") {
  static readonly config = Config.all({
    milestoneInterval: Config.schema(MilestoneInterval, "COUPON_EVERY_N_ORDERS").pipe(
      Config.withDefault(5),
    ),
    discountPercent: Config.schema(DiscountPercent, "COUPON_DISCOUNT_PERCENT").pipe(
      Config.withDefault(10),
    ),
    databasePath: Config.String("DATABASE_PATH").pipe(Config.withDefault(defaultDatabasePath)),
    port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  });

  static readonly layer = Layer.effect(AppConfig, AppConfig.config);
}
