# 03: Carts

**What to build:** A shopper can create an anonymous cart, set and change item quantities, remove items, and view the cart with live prices, line totals, subtotal, and stock warnings, through the API and on the SPA cart page. Invalid products and quantities never silently enter a cart. See SPEC.md (Cart semantics).

**Blocked by:** 01 — Walking skeleton

**Status:** done

- [x] `POST /api/carts` returns 201 with a cart identified by an unguessable UUIDv7, status `OPEN`
- [x] `PUT /api/carts/{id}/items/{productId}` with `{ quantity }` creates or replaces the line, so it is idempotent (repeating it never doubles the quantity)
- [x] `DELETE /api/carts/{id}/items/{productId}` removes the line
- [x] A quantity that is not an integer from 1 to 99 returns 400 `VALIDATION_ERROR`
- [x] An unknown product returns 404 `PRODUCT_NOT_FOUND`; an unknown cart returns 404 `CART_NOT_FOUND`
- [x] A quantity greater than current inventory returns 409 `INSUFFICIENT_INVENTORY` (soft check; checkout re-validates)
- [x] Cart lines store no price
- [x] `GET /api/carts/{id}` returns `status`, `itemCount`, `subtotalCents`, and for each line: live `unitPriceCents`, `lineTotalCents`, `availableInventory`, and an `insufficientStock` flag
- [x] After an admin price change (via the product table or ticket 02), the cart view reflects the new price
- [x] API tests cover set/replace/remove, each validation error, and the replace-not-increment behaviour
- [x] OpenAPI document regenerated and committed
- [x] (UI, cuttable) Add-to-cart from the catalog; a cart page to edit quantities and remove lines, showing totals and stock warnings; the cart id is kept in local storage; errors appear as toasts keyed by `code`
- [x] `DECISIONS.md` records live pricing, no reservation at add-to-cart, set-quantity semantics, and anonymous bearer carts with no expiry
