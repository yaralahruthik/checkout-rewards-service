import { Context, DateTime, Effect, Layer, Option } from "effect";
import { priceLines } from "../../shared/money.ts";
import { Ids } from "../../shared/ids.ts";
import {
  InsufficientInventory,
  ProductId,
  ProductNotFound,
  insufficientInventory,
  productNotFound,
} from "../products/ProductsApi.ts";
import { ProductRepository } from "../products/ProductRepository.ts";
import {
  Cart,
  CartId,
  CartNotFound,
  CartNotOpen,
  SetQuantity,
  cartNotFound,
  cartNotOpen,
} from "./CartsApi.ts";
import { CartRepository, type CartRow, type LineRow } from "./CartRepository.ts";

/** Prices the lines at the prices they were read with. */
const toCart = (cart: CartRow, rows: ReadonlyArray<LineRow>): Cart => {
  const { lines, subtotalCents } = priceLines(rows);
  return {
    id: cart.id,
    status: cart.status,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents,
    lines: lines.map((line) => ({
      ...line,
      insufficientStock: line.quantity > line.availableInventory,
    })),
    ...(cart.orderId === null ? {} : { orderId: cart.orderId }),
  };
};

export class CartService extends Context.Service<
  CartService,
  {
    readonly create: Effect.Effect<Cart>;
    readonly get: (id: CartId) => Effect.Effect<Cart, CartNotFound>;
    readonly setQuantity: (
      id: CartId,
      productId: ProductId,
      request: SetQuantity,
    ) => Effect.Effect<Cart, CartNotFound | CartNotOpen | ProductNotFound | InsufficientInventory>;
    readonly removeItem: (
      id: CartId,
      productId: ProductId,
    ) => Effect.Effect<Cart, CartNotFound | CartNotOpen>;
  }
>()("api/carts/CartService") {
  static readonly layer = Layer.effect(
    CartService,
    Effect.gen(function* () {
      const repository = yield* CartRepository;
      const products = yield* ProductRepository;

      const create = Effect.gen(function* () {
        const ids = yield* Ids;
        const id = yield* ids.uuidv7;
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        return toCart(yield* repository.insert({ id, createdAt }), []);
      }).pipe(Effect.withSpan("CartService.create"));

      const find = Effect.fn("CartService.find")(function* (id: CartId) {
        const cart = yield* repository.findById(id);
        if (Option.isNone(cart)) {
          return yield* cartNotFound(id);
        }
        return cart.value;
      });

      const get = Effect.fn("CartService.get")(function* (id: CartId) {
        return toCart(yield* find(id), yield* repository.lines(id));
      });

      const setQuantity = Effect.fn("CartService.setQuantity")(function* (
        id: CartId,
        productId: ProductId,
        { quantity }: SetQuantity,
      ) {
        const cart = yield* find(id);
        // Answers CART_NOT_OPEN ahead of product and stock errors. The guard
        // on the write below is what actually enforces it.
        if (cart.status !== "OPEN") {
          return yield* cartNotOpen(id);
        }
        const product = yield* products.findById(productId);
        if (Option.isNone(product)) {
          return yield* productNotFound(productId);
        }
        // A soft check against stock as it is now. Nothing is reserved, so
        // checkout re-checks authoritatively.
        const { availableInventory } = product.value;
        if (quantity > availableInventory) {
          return yield* insufficientInventory([
            { productId, requestedQuantity: quantity, availableInventory },
          ]);
        }
        yield* repository.setQuantity(id, productId, quantity);
        return toCart(cart, yield* repository.lines(id));
      });

      const removeItem = Effect.fn("CartService.removeItem")(function* (
        id: CartId,
        productId: ProductId,
      ) {
        const cart = yield* find(id);
        yield* repository.removeLine(id, productId);
        return toCart(cart, yield* repository.lines(id));
      });

      return CartService.of({ create, get, setQuantity, removeItem });
    }),
  ).pipe(Layer.provide([CartRepository.layer, ProductRepository.layer]));
}
