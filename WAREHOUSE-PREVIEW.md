# Configurable isolated warehouse checkout

This directory is a standalone Git repository based on BigCommerce Open Checkout.
It builds independently and imports no Catalyst code. The earlier Powell/Forney
POC notes describe historical test fixtures; current warehouse behavior is driven
by `window.warehouseCheckout`, not SKUs, location names, or fixed pickup IDs.

Build assets with `npm run dev`. In another terminal run
`STOREFRONT_URL=http://localhost:3011 node poc/warehouse-preview.cjs`.
The runner uses installed Chrome (or `CHROME_EXECUTABLE`). Open Checkout and this
runner can live outside a Catalyst workspace. The runner lets BigCommerce session sync complete before replacing the checkout page. It consumes the documented
`warehouse-preview-v2` JSON response from a storefront checkout URL; any server
adapter can supply the same contract.

```json
{
  "version": 1,
  "preview": true,
  "validation": {
    "endpoint": "https://storefront.example/api/warehouse/validate",
    "token": "short-lived-cart-validation-capability",
    "revision": "server-issued-revision",
    "expiresAt": 2000000000
  },
  "cartId": "validated-cart-id",
  "warehouse": {
    "id": "north",
    "label": "Ship/Pickup at North",
    "pickupLabel": "Pickup at North",
    "locationId": 73,
    "pickupMethodId": 94,
    "allowShipping": true
  }
}
```

The handoff is validated against the rendered checkout ID. Pickup-only warehouses
show a native pickup confirmation; shipping-enabled warehouses offer Ship to me
and configured pickup. The SDK replaces consignments sequentially when switching
modes, preserving the shipping address in session storage. Pickup uses the real
pickup consignment's address and requires separate billing. Legacy
`shipping_pickupinstore` rates are omitted from the shipping choices. Multi-address
shipping is hidden in this single-warehouse preview. Shipping step completion
requires a compatible native pickup method or a permitted shipping rate.

Enhanced checkout styling is supplied by the existing store's enhanced-checkout
configuration. The runner loads locally built JavaScript in the browser only;
it never changes the hosted script URL or any checkout setting. Native API
requests remain live. Order/payment writes are blocked at the browser network
layer, and the preview also intercepts the payment submit control. No purchase is
possible in this milestone. Close Chrome to stop the runner.

The optional `attachPreview(context, page, options)` export supports automated
checks; `options.customer` is an in-memory test credential object used only when
the checkout session requires explicit sign-in. Do not commit credentials.

Before deployment: enforce warehouse validation at final submission, provide
atomic concurrency/stock-change handling, freight/accessorial integration, and
broader payment and catalog coverage. Client configuration is presentation input, not production
authorization. Do not remove preview guards or activate hosted checkout as part
of this milestone.

## Session-sync browser requirement

The earlier HTTP 403 (`Rejected.`) was caused by the automated test using a
`HeadlessChrome` crawler identity. BigCommerce documents this behavior in its
[Catalyst 1.13.1 release notes](https://docs.bigcommerce.com/developer/docs/storefront/catalyst/release-notes/1-13-1).
The normal storefront sign-in and GraphQL checkout handoff work in visible Chrome;
no SDK sign-in fallback or checkout setting change is required.

Use the Chrome window opened by `node poc/warehouse-preview.cjs`. Automated local
preview checks use the same exported `launchPreviewBrowser()` helper. Do not
substitute a headless-shell browser, spoof its headers, or disable browser
security. Catalyst's Chromium Playwright project uses the documented full-browser
`channel: 'chromium'` option instead of the old security-disabling workaround.

The preview reports session-sync failures without logging the checkout token.
Return to the storefront cart to request a fresh handoff if a navigation fails.
Production activation remains outside this local-preview milestone.

## Repeatable local pickup smoke test

With the local storefront running and checkout assets built, use a dedicated
simple physical product with inventory at the selected warehouse. Save a synthetic
test customer's credentials in a private JSON file outside this repository:
`{"email":"test-customer@example.com","password":"test-password"}`.

```sh
STOREFRONT_URL=http://localhost:3011 \
PREVIEW_TEST_PRODUCT_PATH=/your-dedicated-test-product/ \
PREVIEW_TEST_WAREHOUSE_ID=your-configured-warehouse-id \
PREVIEW_TEST_CUSTOMER_FILE=/absolute/private/test-customer.json \
PREVIEW_TEST_OUTPUT_DIR=/absolute/path/to/test-results \
node poc/warehouse-smoke-test.cjs
```

This opens visible Chrome, signs in through the storefront, selects the warehouse,
adds one unit, and follows Preview checkout. It checks session-sync 302, the
signed-in customer and matching cart, enhanced styling, the configured native
pickup method, refresh persistence, and return-to-cart session continuity.
It does not use the SDK sign-in fallback, submit an order, or process a payment.
A successful run writes a sanitized result JSON and a checkout screenshot; treat
screenshots as private because they may show the test customer's contact details.
Run warehouse cases sequentially when using the same test customer.

## Server validation contract (warehouse-preview-v2)

The checkout remains standalone. It imports no Catalyst code and knows only the
configured `validation.endpoint` and its versioned JSON contract. An alternative
storefront backend can implement this contract. The handoff's labels/IDs are
untrusted bootstrap input; checkout renders only after an authenticated response
supplies warehouse policy. Management API credentials never enter checkout.

POST with `Authorization: Bearer <token>`, `Content-Type: application/json`,
`credentials: omit`, and `{cartId, revision, requestedMode?}`. `requestedMode` is
`pickup` or `shipping` only for preflighting a native mode switch. Ordinary checks
omit it and validate the actual cart's consignments. A successful response contains
`{version:1, cartId, revision, warehouse, allowedModes, expiresAt}`. Failures contain
`{code, message}` with 401 (invalid/expired capability), 409 (stale record, stock or
fulfillment conflict), 400 (invalid input), or 503 (verification unavailable).
The server authenticates the cart capability and checks its saved warehouse; a
browser-submitted warehouse ID is never accepted as authorization.

Checks run on initial entry, reload, SDK cart/consignment changes, focus and
visibility return, plus every 15 seconds in a visible tab. Errors disable the
checkout fieldset. Return to the cart for a fresh handoff after a revision change
or capability expiry. Retry is for transient failures. These checks are snapshots;
they do not replace atomic final-submission enforcement. All preview purchase
blocks remain active.

Set `PREVIEW_TEST_VALIDATION=true` for the smoke test's unauthorized-request and
stale-tab checks. Optional `PREVIEW_TEST_CONFLICT_PRODUCT_ID` adds a dedicated
product with no inventory at the selected location to the disposable cart, verifies
an inventory conflict, then removes it in a finally block. This optional setup
requires `PREVIEW_TEST_STORE_ENV_FILE` pointing to a private server environment
file; its management credentials are used in Node only, never sent to the browser.
No product inventory or store setting is modified. Test credentials/capabilities
must not be committed or logged. The smoke-test report omits capabilities.

The isolated runner grants Chrome local-network permission only to the current
checkout origin when the configured validator is the local storefront on
localhost/127.0.0.1. CORS and bearer validation remain enforced. Deployed HTTPS
validators do not need this local development permission.

With a conflict fixture configured, `PREVIEW_TEST_SWITCH_WAREHOUSE_ID` additionally
replaces the disposable cart's item with the alternate-location fixture and uses
the picker to change warehouse. It verifies that older tabs fail and that a new
handoff recovers the updated warehouse. Inventory is never adjusted by this test.
A fresh session-authorized handoff removes consignments incompatible with its
saved warehouse; an unselected draft is allowed so the shopper can choose again.
On focus and periodic checks the SDK reloads checkout to reflect external edits.

## Submit-time validation (simulated milestone)

The payment form now saves pending billing edits (requiring review if the total
changes), refreshes checkout, then requests strict server validation before the
normal SDK submit path or a registered payment-specific submit callback. The
same-tab guard rejects overlapping attempts and disables checkout controls during
verification. Fulfillment switches and background refreshes pause during an attempt.
Every retry performs fresh validation. A validator failure/timeout stops submission.

The standalone contract adds an optional `submission` object to the existing
validator request: `grandTotal`, sorted physical `items` (`id`, `productId`,
`variantId`, `quantity`), and sorted `consignments` (`id`, sorted `lineItemIds`,
nullable `pickupMethodId`, nullable `shippingOptionId`). The server must validate
and echo that exact snapshot; older validators cannot silently approve submission.
No Catalyst imports, store IDs, credentials, or payment data are added to checkout.
Configure another store through the existing warehouse/validator bootstrap.

The Catalyst reference validator requires complete, compatible native fulfillment,
checks current warehouse authorization and stock, and reads checkout again after
the stock check to detect concurrent mutations. This is a snapshot comparison,
not a lock or inventory reservation. The request body is limited to 64 KiB.

Preview still blocks actual execution, even after successful verification, and
skips payment finalization. Existing DOM and runner network blocks remain in place.
Tests use in-memory executors and fixtures, never real orders or payments. The
simulated race tests intentionally show that independent tabs may both pass and
that remote changes after the final check remain possible. No cross-tab exactly-once
or mandatory native-server approval guarantee is claimed. Wallet buttons that do
not enter this form, asynchronous gateway callbacks, and production redirect recovery
require provider-specific validation before enabling those methods for production.

Run the standalone tests with the installed Jest CLI and
`--config packages/core/jest.config.js --runInBand --reporters=default`, selecting
`warehouse/submissionGuard.test.ts`, `warehouse/submission.test.ts`,
`warehouse/validation.test.ts`, and `payment/Payment.test.tsx` under
`packages/core/src/app/`. These are local simulations, not live sandbox purchases.

## Required initialization in a standalone staging build

Build this repository independently with `WAREHOUSE_CHECKOUT_MODE=staging` and
`WAREHOUSE_CHECKOUT_STORES` containing public routing policy, for example:

```sh
WAREHOUSE_CHECKOUT_MODE=staging \
WAREHOUSE_CHECKOUT_STORES='[{"checkoutOrigin":"https://checkout-a.example","validationEndpoint":"https://store-a.example/api/warehouse/validate"},{"checkoutOrigin":"https://checkout-b.example","validationEndpoint":"https://store-b.example/api/warehouse/validate"}]' \
npm run build
```

The origins and endpoints must use HTTPS without URL credentials, query strings,
or fragments. Checkout origins must be unique. Build configuration errors stop
the build. This public policy and required staging mode are embedded in the
bundle; deleting the runtime handoff cannot switch it to ordinary checkout.
Webpack emits `warehouse-build.json`, and Nx build inputs include both variables
so a cached ordinary build cannot satisfy a staging build request.

Each store's existing `window.warehouseCheckout` handoff remains version 1 with
`preview: true`, cart ID, warehouse presentation fields, and the short-lived
validation capability. The current checkout origin selects its permitted
validator endpoint from the embedded mapping. Invalid/missing/expired/wrong-cart
handoffs, an unknown origin, or a mismatched endpoint show a blocking message
without mounting the SDK checkout app. A valid handoff must also receive a
matching authenticated validator response before the app mounts. The existing
validation gate continues checking during editing and submission.

The standard payment form opts into the validated submission path with
`data-warehouse-validated-submit="true"`. With a valid initialized warehouse,
normal button clicks and keyboard form submissions reach Formik, billing save,
Freight and warehouse validation. The final preview executor still refuses to
place an order unless the separate cart-scoped Check authorization is enabled.
Unmarked forms, provider-specific controls, and missing/invalid initialization
remain blocked by the document capture guard. The marker routes UI events; it
is not a server-side authorization mechanism.

No staging purchase is enabled. The DOM purchase guards remain active even if
the handoff is removed, the submission wrapper rejects missing required config,
and the existing preview executor/finalization guards remain in place. Backend
validation is still the authority; the build policy is not a new server-side
order-submission enforcement boundary.

`WAREHOUSE_CHECKOUT_MODE=off` is the default normal checkout build. It does not
require a warehouse handoff. For compatibility, an explicitly supplied legacy
preview handoff still uses preview validation and purchase guards. Unknown mode
values fail. Enabled warehouse staging stores must use the staging bundle.

Use a private backend environment for management credentials, Redis, signing,
and warehouse inventory policy. None belong in this public build mapping. The
same standalone bundle can carry several store mappings, and all warehouse IDs
and labels still come from each server-issued, validated handoff. Checkout has
no Catalyst package or backend implementation dependency.

Runner-independent initialization is now implemented as described below; hosted
activation and verification against real hosted headers remain separate. The existing
native SDK final-submission enforcement limitation is unchanged.


## Runner-independent staging initialization

The standalone staging build can authorize an ordinary browser without the POC
runner. Add a public `initializationEndpoint` to each `WAREHOUSE_CHECKOUT_STORES`
entry, alongside `checkoutOrigin` and `validationEndpoint`, for example:

```json
[{"checkoutOrigin":"https://checkout.example","validationEndpoint":"https://storefront.example/api/warehouse/validate","initializationEndpoint":"https://storefront.example/warehouse-initialize/"}]
```

The initialization URL is an exact HTTPS URL without credentials, query, or
fragment. Use the storefront's actual localized path where needed. It may be
implemented by any backend that follows this contract; no Catalyst imports or
backend secrets enter the checkout build. Existing runner-supplied handoffs remain
supported. An absent endpoint provides no ordinary-browser authorization fallback.

Once the standalone staging checkout is loaded, it initially shows **Continue
securely**. Catalyst's cart-entry route continues to return its protected preview
handoff instead of redirecting shoppers into an unactivated standard checkout.
Connecting a normal cart redirect requires separately verified hosted activation.
Clicking the authorization button opens the configured storefront endpoint
in a top-level window, allowing that origin's existing first-party session cookies.
The request carries only `cartId`, a random 64-hex-character `requestId`, and the
exact `checkoutOrigin`. These fields are identifiers/correlation, not authorization.

The storefront must authorize the cart against its own session and channel before
issuing the existing signed warehouse capability. It sends a message to its opener
using the exact allowlisted checkout origin:

```text
{ protocol: "warehouse-initialization-v1", requestId, cartId, warehouseCheckout }
```

A failure instead sends `{protocol, requestId, cartId, error:"AUTHORIZATION_FAILED"}`.
Checkout verifies the popup Window identity, sender origin, request ID, cart ID,
preview-only payload and configured validator endpoint, then calls the validator.
The SDK app is mounted only after that authenticated server check succeeds. A
server-side failure, popup denial/closure, missing opener or 60-second timeout
blocks checkout. A retry starts a fresh request and superseded replies cannot
install authorization. Initialization does not submit orders or change consignments.

Capabilities stay in page memory: they are not placed in URLs, localStorage or
sessionStorage. Reloading checkout requires another authorization click; after an
expired capability or session, use retry or sign in on the storefront and reopen
checkout from the cart. Missing state and direct-entry carts are never authorized
from their ID alone. This milestone does not implement silent token renewal or
external-payment return recovery; purchasing and finalization remain blocked.

The storefront response uses no-store, no-referrer, a nonce-based script CSP and
frame denial. The real checkout/storefront deployment must preserve the opener
relationship: incompatible COOP headers, site access gates or popup policies will
fail closed. Do not weaken hosted browser security to make the test pass. Test
that compatibility during later activation. No BigCommerce hosted loader setting
was changed by this implementation. Normal hosted checkout will use the custom
code only after a separately authorized activation.

Isolated tests cover the transport, source/origin/nonce forgery, expiry, retries,
server validation, purchase guards, real Chrome popup messaging and read-only
initialization concurrent with Redis warehouse changes. Browser tests use synthetic
origins and fixtures; they do not establish real hosted checkout compatibility.


## Cart-scoped Check-only test permission (not activated)

Purchasing remains blocked by default. A staging store mapping may explicitly set `allowCheckTest: true`; do not enable this as part of isolated testing or set warehouse mode to `off`. Backend authorization is independently required. No existing environment, hosted setting, or loader is changed by this implementation.

The standalone validator contract adds optional `checkTestAuthorization: {version:1, methodId:"cheque", token, expiresAt}` to successful authenticated validation responses. Keep `preview:true`. Permission is held in module-local state bound to the current cart, warehouse revision and validation credential. An alternative backend can implement the same contract without importing Catalyst. The reference backend signs a one-cart, one-customer, one-item policy with an exact total/currency, warehouse revision, origin and short expiry. It does not expose management credentials.

Normal billing preparation, checkout refresh, strict submission snapshot validation, Freight checks and same-tab exclusion still run. The current mapped payment method, selected method and custom-callback status are part of the submission fingerprint. Only native `cheque`, without a gateway/custom callback or zero-payment fallback, can claim execution. Other payment methods remain blocked at submission; rendering a payment field is not authorization to execute it. Redirect finalization remains skipped because preview stays true.

Immediately before SDK execution, POST the strict snapshot plus `checkTest: {token, methodId:"cheque", gatewayId:null}` to the existing validator. Require `checkTestClaimed:true`, the identical grant token, and the usual matching snapshot/cart/revision. The backend must validate again and atomically claim the cart. Recheck the local fingerprint, Freight approval and grant expiry after the response. No acknowledgement, lost response, or changed checkout means no execution.

The browser consumes its attempt before sending the claim; it never automatically clears that state. The backend uses a durable cart-scoped tombstone, not an expiring lock, so a reload/new tab/new grant cannot authorize a second cooperating attempt. All ambiguous outcomes require operator reconciliation. This does not prevent direct native API bypass or changes after validation; it is not exactly-once BigCommerce submission enforcement.

Tests exercise a simulated executor only. Before any separately authorized order, run the focused warehouse, `renderCheckout.staging`, and `payment/Payment` tests and verify both opt-ins are absent in ordinary builds. A future controlled test would authorize one dedicated cart with Check, activate the tested hosted bundle temporarily, reconcile the resulting order and location inventory, revoke the policy, and restore the saved loader. Do not retry an ambiguous submission or reset an attempt record automatically.


## Persistent attempt recovery

Checkout retains a cart-scoped recovery marker before requesting a Check or Test payment provider claim. It stores only an attempted flag, keyed by validator endpoint and cart ID, in browser local storage; storage events lock other open tabs. Storage failure retains a same-tab memory lock. The backend's permanent Redis claim remains authoritative across browsers and backend instances; the browser marker is only a conservative UX hint.

The standalone validator contract accepts HTTP 409 with `{ "version": 1, "cartId": "...", "revision": "...", "code": "SUBMISSION_REVIEW_REQUIRED", "recovery": { "status": "review_required" } }`. It must authenticate the signed cart capability before disclosing recovery. Recovery is checked before active-cart lookup and before issuing grants, including when the test policy has been removed or the cart converted to an order. Storage unavailability fails closed. No checkout-to-Catalyst source dependency is required.

After an attempt, checkout disables payment, hides verification retry, and instructs the shopper not to submit again and to contact the store. Refreshing or ordinary verification never clears recovery. A response loss is not evidence of failure: there is no automatic retry, claim release, payment reconciliation, or success/failure inference. Pre-claim connectivity failures still allow **verification** retries. The active authorized attempt may finish; recovery blocks subsequent attempts.

An operator must inspect the order/payment outcome before any separately authorized recovery action. Expired signed capabilities cannot read backend status; purchasing remains blocked and a fresh authenticated handoff is required. These changes do not enable general purchasing or production payment methods, and do not remove the previously documented native SDK enforcement boundary.
