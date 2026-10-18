import { Layer } from "effect";
import { HttpApiMiddleware } from "effect/http-api";

/**
 * The single seam where administrator authentication would be added.
 *
 * Every administrative group ends with `.prefix("/admin").middleware(AdminAuth)`,
 * so its endpoints live under `/api/admin` and run behind this middleware.
 * Today it lets every request through: the assignment has no users or
 * credentials. Adding auth means giving `AdminAuth` a `security` scheme and an
 * error (for example a bearer token and a 401 `UNAUTHORIZED`) and checking the
 * credential in `AdminAuthLive`; no admin endpoint or handler changes.
 */
export class AdminAuth extends HttpApiMiddleware.Service<AdminAuth>()("api/shared/AdminAuth") {}

export const AdminAuthLive = Layer.succeed(AdminAuth, (httpEffect) => httpEffect);
