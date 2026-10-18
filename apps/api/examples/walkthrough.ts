/**
 * Executable request examples. Walks a running API through the happy path, a
 * retried checkout, a conflicting checkout, a price change, an oversell race,
 * coupon generation and redemption, a double redemption, validation errors and
 * the report. Every request and response is printed, and every response is
 * checked against the documented status and error code: the process exits
 * non-zero on the first surprise.
 *
 *   pnpm dev            # or: pnpm --filter @uniblox/api start
 *   pnpm examples       # API_URL defaults to http://localhost:3000
 *
 * It can run repeatedly against one database: it restocks a product it needs
 * when earlier runs sold it too low, and puts back the prices and the keycap
 * stock it changes when it completes. Its orders and coupons are real and stay
 * in the report. After a failed run, `pnpm db:reset` restores the seed.
 */

const baseUrl = process.env.API_URL ?? "http://localhost:3000";

type Json = any;

interface Reply {
  readonly status: number;
  readonly body: Json;
}

const LAPTOP_STAND = 4; // 1999 cents: 10% off is 199.9 cents, rounded down
const USB_C_HUB = 3;
const KEYBOARD = 1;
const MOUSE = 2;
const KEYCAP_SET = 6; // the limited-stock product

const show = (body: unknown) => {
  const text = JSON.stringify(body);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

const send = async (method: string, path: string, body?: unknown): Promise<Reply> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};

/** Sends one request, prints it, and fails unless the status (and error code) match. */
const call = async (
  method: string,
  path: string,
  options: { body?: unknown; status: number; code?: string },
): Promise<Json> => {
  console.log(`\n→ ${method} ${path}${options.body === undefined ? "" : ` ${show(options.body)}`}`);
  const reply = await send(method, path, options.body);
  console.log(`← ${reply.status} ${show(reply.body)}`);
  expectReply(reply, options.status, options.code);
  return reply.body;
};

/** Sends the same kind of request several times at once and prints the outcomes. */
const race = async (label: string, requests: ReadonlyArray<() => Promise<Reply>>) => {
  console.log(`\n⇉ ${label}: ${requests.length} requests at once`);
  const replies = await Promise.all(requests.map((request) => request()));
  for (const reply of replies) {
    console.log(`← ${reply.status} ${reply.body?.code ?? reply.body?.id ?? ""}`);
  }
  return replies;
};

const expectReply = (reply: Reply, status: number, code?: string) => {
  if (reply.status !== status || (code !== undefined && reply.body?.code !== code)) {
    fail(`expected ${status}${code === undefined ? "" : ` ${code}`}, got ${reply.status}`);
  }
};

const check = (condition: boolean, message: string) => {
  if (!condition) fail(message);
  console.log(`  ✓ ${message}`);
};

const fail = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const section = (title: string) => console.log(`\n\n## ${title}`);

const productById = async (id: number) => {
  const products: Json[] = (await send("GET", "/api/products")).body;
  return products.find((product) => product.id === id);
};

const setProduct = (id: number, update: object) =>
  call("PATCH", `/api/admin/products/${id}`, { body: update, status: 200 });

/** Restocks a product through the admin update when a rerun has sold it too low. */
const ensureStock = async (id: number, units: number) => {
  const product = await productById(id);
  if (product.availableInventory < units) await setProduct(id, { availableInventory: units });
};

const cartWith = async (...lines: ReadonlyArray<readonly [number, number]>) => {
  const cart = await call("POST", "/api/carts", { status: 201 });
  for (const [productId, quantity] of lines) {
    await call("PUT", `/api/carts/${cart.id}/items/${productId}`, {
      body: { quantity },
      status: 200,
    });
  }
  return cart.id as string;
};

const count = (replies: ReadonlyArray<Reply>, status: number, code?: string) =>
  replies.filter((r) => r.status === status && (code === undefined || r.body?.code === code))
    .length;

// ---------------------------------------------------------------------------

section("Catalog");
await call("GET", "/api/products", { status: 200 });

section("Happy path: build a cart and check it out");
await ensureStock(KEYBOARD, 2);
await ensureStock(LAPTOP_STAND, 3);
const cartId = await cartWith([KEYBOARD, 2], [LAPTOP_STAND, 1]);
console.log("\nSetting a quantity replaces it, so a retried PUT cannot double it:");
await call("PUT", `/api/carts/${cartId}/items/${LAPTOP_STAND}`, {
  body: { quantity: 3 },
  status: 200,
});
const retriedPut = await call("PUT", `/api/carts/${cartId}/items/${LAPTOP_STAND}`, {
  body: { quantity: 3 },
  status: 200,
});
check(retriedPut.itemCount === 5, "the retried PUT left 5 units in the cart, not 8");
await call("PUT", `/api/carts/${cartId}/items/${MOUSE}`, { body: { quantity: 1 }, status: 200 });
await call("DELETE", `/api/carts/${cartId}/items/${MOUSE}`, { status: 200 });
const cart = await call("GET", `/api/carts/${cartId}`, { status: 200 });
const checkoutBody = { expectedSubtotalCents: cart.subtotalCents };
const order = await call("POST", `/api/carts/${cartId}/checkout`, {
  body: checkoutBody,
  status: 201,
});
check(order.totalCents === cart.subtotalCents, "the order total is the subtotal the cart showed");
await call("GET", `/api/orders/${order.id}`, { status: 200 });
const closed = await call("GET", `/api/carts/${cartId}`, { status: 200 });
check(
  closed.status === "CHECKED_OUT" && closed.orderId === order.id,
  "the cart points at its order",
);

section("Retried checkout: the same request again replays the order");
const replay = await call("POST", `/api/carts/${cartId}/checkout`, {
  body: checkoutBody,
  status: 200,
});
check(replay.id === order.id, "200 with the same order id, no second order");

await ensureStock(USB_C_HUB, 1);
const stormCart = await cartWith([USB_C_HUB, 1]);
const hubBefore = (await productById(USB_C_HUB)).availableInventory;
const storm = await race(
  "Retry storm on one cart",
  Array.from({ length: 5 }, () => () => send("POST", `/api/carts/${stormCart}/checkout`)),
);
check(count(storm, 201) === 1 && count(storm, 200) === 4, "one 201 and four 200 replays");
check(new Set(storm.map((r) => r.body.id)).size === 1, "every response carries the same order id");
check((await productById(USB_C_HUB)).availableInventory === hubBefore - 1, "stock was taken once");

section("Conflicting checkout: a different coupon on a checked-out cart");
const conflict = await call("POST", `/api/carts/${cartId}/checkout`, {
  body: { couponCode: "SAVE10-00000000" },
  status: 409,
  code: "CART_ALREADY_CHECKED_OUT",
});
check(conflict.details.orderId === order.id, "the conflict names the existing order");
await call("PUT", `/api/carts/${cartId}/items/${MOUSE}`, {
  body: { quantity: 1 },
  status: 409,
  code: "CART_NOT_OPEN",
});

section("Price change between viewing the cart and checking out");
await ensureStock(MOUSE, 3);
const priceCart = await cartWith([MOUSE, 2]);
const seen = await call("GET", `/api/carts/${priceCart}`, { status: 200 });
const mouse = await productById(MOUSE);
await setProduct(MOUSE, { unitPriceCents: mouse.unitPriceCents + 500 });
const changed = await call("POST", `/api/carts/${priceCart}/checkout`, {
  body: { expectedSubtotalCents: seen.subtotalCents },
  status: 409,
  code: "PRICE_CHANGED",
});
const stillOpen = await call("GET", `/api/carts/${priceCart}`, { status: 200 });
check(stillOpen.status === "OPEN", "the refused checkout left the cart open");
const repriced = await call("POST", `/api/carts/${priceCart}/checkout`, {
  body: { expectedSubtotalCents: changed.details.subtotalCents },
  status: 201,
});
await setProduct(MOUSE, { unitPriceCents: mouse.unitPriceCents });
const snapshot = await call("GET", `/api/orders/${repriced.id}`, { status: 200 });
check(
  snapshot.lines[0].unitPriceCents === mouse.unitPriceCents + 500,
  "the order keeps the price it was charged after the catalog price changes back",
);

section("Oversell: five shoppers, two units left");
const keycaps = await productById(KEYCAP_SET);
await setProduct(KEYCAP_SET, { availableInventory: 2 });
const raceCarts: string[] = [];
for (let i = 0; i < 5; i++) raceCarts.push(await cartWith([KEYCAP_SET, 1]));
const oversell = await race(
  "Checkouts for the last two keycap sets",
  raceCarts.map((id) => () => send("POST", `/api/carts/${id}/checkout`)),
);
check(count(oversell, 201) === 2, "exactly two checkouts succeeded");
check(count(oversell, 409, "INSUFFICIENT_INVENTORY") === 3, "three got INSUFFICIENT_INVENTORY");
check((await productById(KEYCAP_SET)).availableInventory === 0, "stock ended at 0, never below");
await setProduct(KEYCAP_SET, { availableInventory: keycaps.availableInventory });

section("Validation and not-found errors");
const scratch = await cartWith();
await call("PUT", `/api/carts/${scratch}/items/${MOUSE}`, {
  body: { quantity: 0 },
  status: 400,
  code: "VALIDATION_ERROR",
});
await call("PUT", `/api/carts/${scratch}/items/${MOUSE}`, {
  body: { quantity: 1.5 },
  status: 400,
  code: "VALIDATION_ERROR",
});
await call("PUT", `/api/carts/${scratch}/items/999`, {
  body: { quantity: 1 },
  status: 404,
  code: "PRODUCT_NOT_FOUND",
});
await call("PUT", `/api/carts/${scratch}/items/${KEYCAP_SET}`, {
  body: { quantity: 99 },
  status: 409,
  code: "INSUFFICIENT_INVENTORY",
});
await call("POST", `/api/carts/${scratch}/checkout`, { status: 422, code: "EMPTY_CART" });
await call("PUT", `/api/carts/${scratch}/items/${MOUSE}`, { body: { quantity: 1 }, status: 200 });
await call("POST", `/api/carts/${scratch}/checkout`, {
  body: { couponCode: "NOT-A-COUPON" },
  status: 422,
  code: "COUPON_INVALID",
});
await call("GET", "/api/carts/not-a-uuid", { status: 400, code: "VALIDATION_ERROR" });
await call("GET", "/api/carts/01890a5d-ac96-774b-bcce-b302099a8057", {
  status: 404,
  code: "CART_NOT_FOUND",
});
await call("GET", "/api/orders/01890a5d-ac96-774b-bcce-b302099a8057", {
  status: 404,
  code: "ORDER_NOT_FOUND",
});
await call("PATCH", `/api/admin/products/${MOUSE}`, {
  body: {},
  status: 400,
  code: "VALIDATION_ERROR",
});

section("Coupon generation");
console.log("Issue any milestones already reached, oldest first, one per request:");
let refusal: Json = null;
for (;;) {
  const reply = await send("POST", "/api/admin/coupons/generate");
  console.log(`\n→ POST /api/admin/coupons/generate\n← ${reply.status} ${show(reply.body)}`);
  if (reply.status === 409) {
    expectReply(reply, 409, "NO_ELIGIBLE_MILESTONE");
    refusal = reply.body;
    break;
  }
  expectReply(reply, 201);
}
const { orderCount, nextMilestoneOrderCount } = refusal.details;
const needed = nextMilestoneOrderCount - orderCount;
console.log(`\nPlace ${needed} orders to reach milestone ${nextMilestoneOrderCount}:`);
await ensureStock(USB_C_HUB, needed);
for (let i = 0; i < needed; i++) {
  await call("POST", `/api/carts/${await cartWith([USB_C_HUB, 1])}/checkout`, { status: 201 });
}
const generation = await race(
  "Generate requests at exactly one eligible milestone",
  Array.from({ length: 3 }, () => () => send("POST", "/api/admin/coupons/generate")),
);
check(count(generation, 201) === 1, "exactly one coupon was generated");
check(
  count(generation, 409, "NO_ELIGIBLE_MILESTONE") === 2,
  "the others got NO_ELIGIBLE_MILESTONE",
);
const coupon = generation.find((r) => r.status === 201)!.body;
check(
  coupon.milestoneOrderCount === nextMilestoneOrderCount,
  "it rewards the milestone just reached",
);

section("Coupon redemption and a double redemption");
await ensureStock(LAPTOP_STAND, 2);
const first = await cartWith([LAPTOP_STAND, 1]);
const second = await cartWith([LAPTOP_STAND, 1]);
const redemption = await race(
  `Two checkouts with ${coupon.code}`,
  [first, second].map(
    (id) => () => send("POST", `/api/carts/${id}/checkout`, { couponCode: coupon.code }),
  ),
);
check(count(redemption, 201) === 1, "one checkout redeemed the coupon");
check(
  count(redemption, 409, "COUPON_ALREADY_REDEEMED") === 1,
  "the other got COUPON_ALREADY_REDEEMED",
);
const discounted = redemption.find((r) => r.status === 201)!.body;
const expectedDiscount = Math.floor((discounted.subtotalCents * coupon.discountPercent) / 100);
console.log(`  ${show(discounted)}`);
check(
  discounted.discountCents === expectedDiscount &&
    discounted.totalCents === discounted.subtotalCents - expectedDiscount,
  `discount is floor(${discounted.subtotalCents} × ${coupon.discountPercent}%) = ${expectedDiscount} cents`,
);
const loserCartId = [first, second][redemption.findIndex((r) => r.status === 409)];
const loserCart = await call("GET", `/api/carts/${loserCartId}`, { status: 200 });
check(loserCart.status === "OPEN", "the losing cart is still open");
await call("POST", `/api/carts/${loserCartId}/checkout`, {
  body: { couponCode: coupon.code },
  status: 409,
  code: "COUPON_ALREADY_REDEEMED",
});
await call("GET", "/api/admin/coupons", { status: 200 });

section("Report: read-only, and reconciles with the order and coupon lists");
const report = await call("GET", "/api/admin/report", { status: 200 });
const again = await call("GET", "/api/admin/report", { status: 200 });
check(JSON.stringify(report) === JSON.stringify(again), "two consecutive reports are identical");
const orders: Json[] = await call("GET", "/api/admin/orders", { status: 200 });
const coupons: Json[] = await call("GET", "/api/admin/coupons", { status: 200 });
const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0);
check(report.orderCount === orders.length, `orderCount = ${orders.length} listed orders`);
check(
  report.grossRevenueCents === sum(orders.map((o) => o.subtotalCents)) &&
    report.totalDiscountsCents === sum(orders.map((o) => o.discountCents)) &&
    report.netRevenueCents === sum(orders.map((o) => o.totalCents)),
  "gross, discounts and net equal the sums over the listed orders",
);
check(
  report.grossRevenueCents - report.totalDiscountsCents === report.netRevenueCents,
  "gross − discounts = net",
);
check(
  report.coupons.generated === coupons.length &&
    report.coupons.redeemed === coupons.filter((c) => c.status === "REDEEMED").length,
  "coupon counts match the coupon list",
);
for (const product of report.products) {
  const sold = sum(
    orders
      .flatMap((o) => o.lines.filter((l: Json) => l.productId === product.productId))
      .map((l) => l.quantity),
  );
  check(product.purchasedQuantity === sold, `${product.productName}: ${sold} sold`);
}

console.log("\n\nAll examples behaved as documented.");
