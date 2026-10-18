import { Context, Effect, Layer } from "effect";
import { Report } from "./ReportApi.ts";
import { ReportRepository } from "./ReportRepository.ts";

export class ReportService extends Context.Service<
  ReportService,
  {
    /** Computed on read: there are no stored counters to drift from the orders. */
    readonly get: Effect.Effect<Report>;
  }
>()("api/report/ReportService") {
  static readonly layer = Layer.effect(
    ReportService,
    Effect.gen(function* () {
      const repository = yield* ReportRepository;
      return ReportService.of({ get: repository.get });
    }),
  ).pipe(Layer.provide(ReportRepository.layer));
}
