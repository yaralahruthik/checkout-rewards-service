import { Context, Effect, Layer, Option } from "effect";
import { Order, OrderId, OrderNotFound, orderNotFound } from "./OrdersApi.ts";
import { OrderRepository } from "./OrderRepository.ts";

export class OrderService extends Context.Service<
  OrderService,
  {
    readonly get: (id: OrderId) => Effect.Effect<Order, OrderNotFound>;
    readonly list: Effect.Effect<ReadonlyArray<Order>>;
  }
>()("api/orders/OrderService") {
  static readonly layer = Layer.effect(
    OrderService,
    Effect.gen(function* () {
      const repository = yield* OrderRepository;

      const get = Effect.fn("OrderService.get")(function* (id: OrderId) {
        const order = yield* repository.findById(id);
        if (Option.isNone(order)) {
          return yield* orderNotFound(id);
        }
        return order.value;
      });

      return OrderService.of({ get, list: repository.list });
    }),
  ).pipe(Layer.provide(OrderRepository.layer));
}
