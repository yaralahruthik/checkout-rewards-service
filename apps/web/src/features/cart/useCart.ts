import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/api/fetcher";
import {
  cartsCreateCart,
  getCartsGetCartQueryKey,
  useCartsGetCart,
  useCartsRemoveItem,
  useCartsSetItemQuantity,
} from "@/api/generated/carts/carts";
import type { Cart } from "@/api/generated/model";
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

  const setQuantity = async (productId: number, quantity: number) => {
    let id = cartId;
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
    cart.data?.lines.find((line) => line.productId === productId)?.quantity ?? 0;

  const isLoading = cartId !== null && cart.isPending;

  return {
    data: cartId === null ? undefined : cart.data,
    isLoading,
    /** A load failure other than a forgotten cart, which is simply treated as no cart. */
    error: lostCart ? null : cart.error,
    // Writes wait for the cart to exist and load: quantities are absolute, so
    // one computed from a cart that has not loaded yet would overwrite the real one.
    isPending: isLoading || creating || setItemQuantity.isPending || removeItem.isPending,
    setQuantity,
    remove,
    quantityOf,
  };
};

export type CartHandle = ReturnType<typeof useCart>;
