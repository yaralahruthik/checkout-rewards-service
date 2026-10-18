import { Effect, Predicate, Schema, SchemaIssue } from "effect";
import { HttpApiMiddleware } from "effect/http-api";

/**
 * Every error body has the same shape: a stable machine-readable `code`, a
 * human-readable `message`, and structured `details`. Each error class pins
 * its `code` literal and HTTP status, so both appear in the OpenAPI document.
 */
export const errorFields = <const Code extends string, Details extends Schema.Top>(
  code: Code,
  details: Details,
) => ({
  code: Schema.tag(code),
  message: Schema.String,
  details,
});

export const ValidationIssue = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Int])),
  message: Schema.String,
});

export class ValidationError extends Schema.Error<ValidationError>("ValidationError")(
  errorFields(
    "VALIDATION_ERROR",
    Schema.Struct({
      location: Schema.Literals(["path", "query", "headers", "body"]),
      issues: Schema.Array(ValidationIssue),
    }),
  ),
  { httpApiStatus: 400, description: "The request did not match the endpoint's schema." },
) {}

/**
 * Applied to the whole API: turns request decoding failures into a
 * `VALIDATION_ERROR` body instead of the framework's empty 400 response.
 */
export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()(
  "api/shared/RequestValidation",
  { error: ValidationError },
) {}

const locations = {
  Params: "path",
  Query: "query",
  Headers: "headers",
  Payload: "body",
} as const;

const toIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export const RequestValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(
  RequestValidation,
  (error) => {
    // Body and ResponseHeaders failures happen while encoding our own
    // response: they are server bugs, so they stay as 500s.
    if (error.kind === "Body" || error.kind === "ResponseHeaders") {
      return Effect.fail(error);
    }
    const { issues } = toIssues(error.cause.issue);
    return Effect.fail(
      new ValidationError({
        message: `Invalid request ${locations[error.kind]}`,
        details: {
          location: locations[error.kind],
          issues: issues.map((issue) => ({
            path: (issue.path ?? []).map((segment) => {
              const key = Predicate.isObject(segment) ? segment.key : segment;
              return Predicate.isNumber(key) ? key : String(key);
            }),
            message: issue.message,
          })),
        },
      }),
    );
  },
);
