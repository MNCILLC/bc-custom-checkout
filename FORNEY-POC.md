# Forney shipping and pickup preview

Result: partial pass. Local browser preview only; no deployment or checkout/shipping settings changes, no order, and no payment.

The prototype now recognizes native Forney method 1 as well as Powell method 2. For carts containing only the dedicated CODEX-FORNEY-ONLY- test SKU, the active fulfillment step offers Ship to me / Pickup in Forney, TX. Switching deletes the previous consignment before creating the replacement. The prior delivery address is cached in sessionStorage keyed to the test checkout so it can be restored after pickup and refresh. The shipping form is unmounted while replacement is in progress. Billing stays separate for pickup. Fixed pickup metadata is a prototype limitation.

Dedicated product 386, variant 707, SKU CODEX-FORNEY-ONLY-20261117-512035, price $50, weight 1. Forney stock 3, Powell 0. Cart ad3571dc-608e-4fb8-9fe5-a17425892d30 uses existing synthetic customer 5.

## Observed results

- Native Forney pickup displayed 8975 FM740, Forney TX 75126, reached Check and separate billing, and survived refresh.
- Shipping -> pickup -> shipping replaced consignments, never retained both, and restored the delivery address (127 U.S. Highway 14-A West, Powell WY 82435). Shipping mode also survived refresh.
- Enhanced desktop and mobile layouts rendered; the final mobile layout had no horizontal overflow. No browser page errors.
- Actual shipping was BLOCKED: the only returned quote was the legacy shipping_pickupinstore / Pick up at warehouse / $0 option. The standard shipping form auto-selected it. This does not prove delivery shipping. Freight Shipping is enabled for the channel but returned no quote for this product/destination. Flat rate is disabled. Root cause was not investigated beyond this test, and no shipping settings were changed.
- Nonzero shipping charge removal/restoration and real shipping progression to payment remain unverified. A production Ship to me path must also exclude the legacy pickup shipping option.
- Build, TypeScript, 95 focused tests and 19 live readback assertions passed. No order/payment submission attempts. Latest order stayed 106. Fixture stock remained Forney 3 / Powell 0. Checkout settings, shipping zones/methods, pickup methods, inventory settings and location records matched baselines.

## Retained evidence

The external work/forney-enhanced-preview directory contains request/response evidence and local state. The reusable browser harness is poc/forney-preview.cjs; FORNEY_PREVIEW_STATE_DIR selects that external state directory. Credentials and one-use redirect tokens are outside this repository. A new redirect URL is required to rerun the isolated browser. Build assets remain in build/. Browser and watcher are stopped.

The unsubmitted cart and dedicated product remain for inspection. The current cart is back in shipping mode with the legacy option automatically selected, not a delivery quote. No shipping Continue to payment or Place order was used to claim shipping success.
