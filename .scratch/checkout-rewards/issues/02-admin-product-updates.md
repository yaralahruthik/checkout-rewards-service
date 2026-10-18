# 02: Admin product updates

**What to build:** An administrator can change a product's price and/or set its available inventory, both from the API and from an admin page in the SPA. This is how price and stock changes between add-to-cart and checkout get demonstrated and tested. See SPEC.md (API contract → administrative endpoints).

**Blocked by:** 01 — Walking skeleton

**Status:** done

- [x] `PATCH /api/admin/products/{id}` accepts an optional `unitPriceCents` and an optional `inventory`; both are absolute values, integers, and non-negative
- [x] Invalid bodies return 400 `VALIDATION_ERROR`; an unknown product returns 404 `PRODUCT_NOT_FOUND`; the response is the updated product
- [x] Admin routes are grouped under `/api/admin`, with a single, documented seam where authentication would be added
- [x] The change is visible through `GET /api/products`
- [x] API tests cover the successful update, validation failure, and not-found
- [x] OpenAPI document regenerated and committed
- [x] (UI, cuttable) An admin page shell with a product editor that uses the generated hook
- [x] `DECISIONS.md` notes which operations are administrative and why there is no auth
