# Standalone local checkout

```sh
cd /Users/kylehurt/dev/bc-apps/bc-custom-checkout
npm run dev
```

This starts webpack on port 8080, loading the ignored `.env.local`. Visit Catalyst at http://localhost:3000 and enter checkout from its cart. Do not open port 8080 as a standalone shopping page: BigCommerce supplies the checkout session and native API context on its checkout origin.

The sandbox Catalyst channel loads `http://localhost:8080/auto-loader-dev.js`. Checkout uses enhanced styling, native pickup/shipping and the Checkout SDK. Local order submission remains blocked. Chrome may request permission for the sandbox checkout site to access localhost. Continue securely opens the authenticated storefront initialization popup; it closes after cart authorization.

Public configuration uses `WAREHOUSE_CHECKOUT_MODE=development` and `WAREHOUSE_CHECKOUT_STORES`, a JSON array mapping each checkoutOrigin to its validationEndpoint and initializationEndpoint. No BigCommerce access token or Redis credential belongs in this repository's browser configuration. Store-specific secrets and warehouse mappings are owned by the storefront/backend. The checkout has no imports or build dependency on Catalyst.

Development mode permits HTTP only for localhost:3000 backend endpoints and rejects production builds. Staging retains HTTPS requirements. For another store, supply its checkout-origin mapping and a compatible authenticated warehouse backend. Keep purchasing blocked until separately authorized and validated.

The prior checkout-powell-poc path is a compatibility symlink. Existing Git history and uncommitted work were preserved. `npm run dev:upstream` retains the original upstream dev command. The root Catalyst LOCAL-DEVELOPMENT.md documents the sandbox activation and private rollback backups.

## Checkout delivery preferences

The optional `freightEndpoint` on each `WAREHOUSE_CHECKOUT_STORES` entry enables delivery-service controls in the delivery step. It must use the same backend origin as `validationEndpoint`. The standalone checkout receives only a short-lived cart capability; the Freight App token stays on the backend. Other stores can omit this field or implement the same contract on their own backend.

For this local workflow, set `freightEndpoint` to `http://localhost:3000/api/warehouse/freight`. Catalyst also needs `WAREHOUSE_FREIGHT_ENABLED=true` and its existing private `FREIGHT_APP_URL`, `FREIGHT_APP_CHECKOUT_TOKEN`, and `BIGCOMMERCE_STORE_HASH`. Restart both dev servers after changing environment configuration.

The endpoint accepts POST `{cartId, revision}` to load preferences and POST `{cartId, revision, update:{selection:{fulfillmentMethod:"ship"|"pickup", accessorials:string[]}, expectedVersion:number}}` to save. Both require the initialized cart capability in the Authorization Bearer header and the allowed checkout Origin. The response is `{version:1, cartId, revision, preferences:null|{fulfillmentMethod,accessorials,version}, services:[{code,label,description}]}`. Responses are not cached. Conflicts return 409 and require the shopper to reload/review; outages fail closed.

Applying shipping options saves them first, replaces existing consignments to discard the previous selected rate, and confirms the preference version before showing native shipping. Pickup clears accessorials and creates a native pickup consignment. Dirty or unconfirmed options block the submission wrapper. Submission checks the preference version and fulfillment mode again before and after warehouse validation. The development preview still refuses to submit an order.

This is not an atomic transaction with BigCommerce order submission: the previously documented native SDK bypass/race boundary remains. Warehouse revision checks detect changes during remote preference writes but cannot undo a write already accepted by the Freight App. Equivalent immediate retries after a lost write response reuse the saved version; conflicting stale updates are rejected. A full page reload requires reviewing delivery preferences again.

Rollback locally: remove `freightEndpoint` from the checkout mapping and restart its dev server, then disable `WAREHOUSE_FREIGHT_ENABLED`. This does not migrate or delete saved preferences. The legacy non-warehouse cart flow remains available unchanged.

For fresh pickup-only carts, the storefront handoff must attach native pickup before redirecting to BigCommerce; otherwise native checkout loading can reject stock held only at that location. Catalyst performs this after session/stock authorization. The checkout opens delivery review once for a prepared cart, so a native completed consignment does not skip the preference confirmation UI. This requirement is part of the backend integration contract for other storefronts as well.

### One-click warehouse initialization (local prototype)

In Catalyst development mode set `WAREHOUSE_ONE_CLICK_ENABLED=true`,
`WAREHOUSE_CURRENT_CUSTOMER_CLIENT_ID`, and `WAREHOUSE_CURRENT_CUSTOMER_CLIENT_SECRET`.
Use an app-level BigCommerce credential pair. In the local checkout's
`WAREHOUSE_CHECKOUT_STORES` entry set `currentCustomerClientId` to the same **public client ID**
and set `handoffEndpoint` to `http://localhost:3000/api/warehouse/initialize` when
Catalyst uses `TRAILING_SLASH=false`. Include the trailing slash if Catalyst requires one.
Restart the local builds after changing their configuration. Keep the client secret on the backend.

The cart's Checkout button starts a two-minute handoff in the configured warehouse Redis.
The redirect carries its random ID in the URL fragment. Hosted checkout reads BigCommerce's
Current Customer token and sends it to the configured validation backend for a single exchange.
The backend checks the cart owner, channel, warehouse revision, items and stock. Starting a new
handoff or switching warehouse carts invalidates the previous attempt. A stale handoff requires
returning to the cart. A direct checkout visit or a reload after successful initialization uses
the existing Continue securely flow. The development purchase block still applies.
