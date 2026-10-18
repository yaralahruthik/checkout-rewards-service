import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { ReportService } from "./ReportService.ts";

const AdminReportGroup = HttpApiBuilder.group(
  Api,
  "adminReport",
  Effect.fn("AdminReportHandlers")(function* (handlers) {
    const report = yield* ReportService;
    return handlers.handle("getReport", () => report.get);
  }),
);

export const ReportHandlers = AdminReportGroup.pipe(Layer.provide(ReportService.layer));
