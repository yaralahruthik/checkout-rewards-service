import { toast } from "sonner";
import { ApiError } from "./fetcher";

const titles: Record<string, string> = {
  VALIDATION_ERROR: "Invalid request",
  CART_NOT_FOUND: "Cart not found",
  PRODUCT_NOT_FOUND: "Product not found",
  INSUFFICIENT_INVENTORY: "Not enough stock",
  EMPTY_CART: "Cart is empty",
  CART_ALREADY_CHECKED_OUT: "Cart already checked out",
  ORDER_NOT_FOUND: "Order not found",
};

/**
 * Shows an API error as a toast titled by its `code`. The toast id is the
 * code, so repeating the same failure replaces the toast instead of stacking.
 */
export const toastApiError = (error: unknown) => {
  if (error instanceof ApiError) {
    toast.error(titles[error.body.code] ?? error.body.code, {
      id: error.body.code,
      description: error.body.message,
    });
  } else {
    toast.error("Request failed", { description: String(error) });
  }
};
