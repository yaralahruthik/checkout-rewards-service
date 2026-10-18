import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../../Api.ts";
import { OrderService } from "./OrderService.ts";

const OrdersGroup = HttpApiBuilder.group(
  Api,
  "orders",
  Effect.fn("OrdersHandlers")(function* (handlers) {
    const orders = yield* OrderService;
    return handlers.handle("getOrder", ({ params }) => orders.get(params.id));
  }),
);

const AdminOrdersGroup = HttpApiBuilder.group(
  Api,
  "adminOrders",
  Effect.fn("AdminOrdersHandlers")(function* (handlers) {
    const orders = yield* OrderService;
    return handlers.handle("listOrders", () => orders.list);
  }),
);

export const OrdersHandlers = Layer.mergeAll(OrdersGroup, AdminOrdersGroup).pipe(
  Layer.provide(OrderService.layer),
);
