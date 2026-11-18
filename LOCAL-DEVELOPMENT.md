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
