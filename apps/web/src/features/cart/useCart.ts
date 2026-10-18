import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/api/fetcher";
import {
  cartsCreateCart,
  getCartsGetCartQueryKey,
  useCartsGetCart,
  useCartsRemoveItem,
  useCartsSetItemQuantity,
} from "@/api/generated/carts/carts";
import { useCheckoutCheckout } from "@/api/generated/checkout/checkout";
import type { Cart, Order, PriceChangedEncodedDetails } from "@/api/generated/model";
import { getOrdersGetOrderQueryKey } from "@/api/generated/orders/orders";
import { getProductsListProductsQueryKey } from "@/api/generated/products/products";
import { toastApiError } from "@/api/toastApiError";

const STORAGE_KEY = "cartId";
const CHANGE_EVENT = "cart-id-change";

const readCartId = () => window.localStorage.getItem(STORAGE_KEY);

const writeCartId = (id: string | null) => {
  if (id === null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

/** The cart id is the cart's only credential, kept in local storage across reloads. */
const useCartId = () => useSyncExternalStore(subscribe, readCartId);

/**
 * The shopper's cart and the operations on it. The cart is created lazily, on
 * the first item set. Every mutation returns the cart, which replaces the
 * cached one; failures become toasts.
 */
export const useCart = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cartId = useCartId();
  const [creating, setCreating] = useState(false);
  const cart = useCartsGetCart<Cart, ApiError>(cartId ?? "", {
    query: { enabled: cartId !== null, retry: false },
  });

  // A stored id can outlive its cart (for example after `db:reset`): forget it.
  const lostCart = cart.error?.body.code === "CART_NOT_FOUND";
  useEffect(() => {
    if (lostCart) writeCartId(null);
  }, [lostCart]);

  const onSuccess = (updated: Cart) =>
    queryClient.setQueryData(getCartsGetCartQueryKey(updated.id), updated);
  const setItemQuantity = useCartsSetItemQuantity<ApiError>({
    mutation: { onSuccess, onError: toastApiError },
  });
  const removeItem = useCartsRemoveItem<ApiError>({
    mutation: { onSuccess, onError: toastApiError },
  });

  // The new totals from a PRICE_CHANGED refusal, waiting for the shopper to confirm.
  const [priceChange, setPriceChange] = useState<PriceChangedEncodedDetails | null>(null);

  // Checkout is never retried automatically: a retry should be the shopper's choice.
  const checkoutCart = useCheckoutCheckout<ApiError>({
    mutation: {
      retry: false,
      onSuccess: (order: Order, { id }) => {
        queryClient.setQueryData(getOrdersGetOrderQueryKey(order.id), order);
        void queryClient.invalidateQueries({ queryKey: getCartsGetCartQueryKey(id) });
        void queryClient.invalidateQueries({ queryKey: getProductsListProductsQueryKey() });
        // The cart is closed now: the next item starts a new one.
        writeCartId(null);
        // The order page keeps the cart id so it can demonstrate a retry.
        void navigate({
          to: "/orders/$orderId",
          params: { orderId: order.id },
          search: { cartId: id },
        });
      },
      onError: (error, { id }) => {
        if (error.body.code === "PRICE_CHANGED") {
          setPriceChange(error.body.details as PriceChangedEncodedDetails);
        } else {
          toastApiError(error);
        }
        // Prices or stock moved: refresh the lines and their stock warnings.
        void queryClient.invalidateQueries({ queryKey: getCartsGetCartQueryKey(id) });
      },
    },
  });

  /** Sends the subtotal the shopper is looking at, so a price change is refused, not charged. */
  const checkout = (expectedSubtotalCents: number) => {
    setPriceChange(null);
    if (cartId !== null) checkoutCart.mutate({ id: cartId, data: { expectedSubtotalCents } });
  };

  // A stored cart checked out elsewhere (another tab) cannot change: the next item starts a new one.
  const checkedOut = cart.data?.status === "CHECKED_OUT";

  const setQuantity = async (productId: number, quantity: number) => {
    let id = checkedOut ? null : cartId;
    if (id === null) {
      setCreating(true);
      try {
        const created = await cartsCreateCart();
        id = created.id;
        writeCartId(id);
      } catch (error) {
        toastApiError(error);
        return;
      } finally {
        setCreating(false);
      }
    }
    setItemQuantity.mutate({ id, productId: String(productId), data: { quantity } });
  };

  const remove = (productId: number) => {
    if (cartId !== null) removeItem.mutate({ id: cartId, productId: String(productId) });
  };

  const quantityOf = (productId: number) =>
    checkedOut ? 0 : (cart.data?.lines.find((line) => line.productId === productId)?.quantity ?? 0);

  const isLoading = cartId !== null && cart.isPending;

  return {
    data: cartId === null ? undefined : cart.data,
    isLoading,
    /** A load failure other than a forgotten cart, which is simply treated as no cart. */
    error: lostCart ? null : cart.error,
    // Writes wait for the cart to exist and load: quantities are absolute, so
    // one computed from a cart that has not loaded yet would overwrite the real one.
    isPending:
      isLoading ||
      creating ||
      setItemQuantity.isPending ||
      removeItem.isPending ||
      checkoutCart.isPending,
    setQuantity,
    remove,
    checkout,
    priceChange,
    dismissPriceChange: () => setPriceChange(null),
    quantityOf,
  };
};

export type CartHandle = ReturnType<typeof useCart>;
