/** The error body every API endpoint returns (see the OpenAPI document). */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

/** Thrown for any non-2xx response, so TanStack Query sees it as an error. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** orval mutator: every generated request goes through here. */
export const apiFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as ApiErrorBody | undefined) ?? {
        code: "UNKNOWN",
        message: `Request failed with status ${response.status}`,
        details: {},
      },
    );
  }
  return body as T;
};
