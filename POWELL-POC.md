# Powell enhanced checkout feasibility prototype

Local preview only. No custom checkout was installed and no checkout settings were changed.

Upstream: BigCommerce checkout-js 1.936.0, commit d63342a874957014152ed25da582b8ce97ed905a.

## Scope

The prototype recognizes one native pickup consignment using existing Powell pickup method 2. It displays the collection address, avoids mounting the shipping form or requesting shipping options, treats the selected pickup as fulfillment, and keeps billing separate from the warehouse address. The store-provided enhancedCheckoutThemeV1 flag is used without overriding it.

Pickup display name, instructions and estimated collection time are fixed to the currently verified Powell configuration for this feasibility test. This is not a complete warehouse picker or production checkout. The total summary retains the upstream “Shipping / Free” label. Forney shipping/pickup, mixed carts, payment submission, final validation on Place order, and deployment are outside this preview test.

## Build and isolated preview

Node 24 / npm 11. Dependencies are installed using npm ci. Run npm run dev to generate development assets in build/. No store configuration needs changing for the isolated harness.

The retained harness is poc/preview.cjs. It uses an isolated Chrome context, authenticates the existing synthetic test customer, serves build/ assets by browser-local interception on the checkout origin, and routes only that browser's /checkout document to the local application. Live checkout API responses are not mocked. It blocks order and payment submissions at the browser network layer.

POWELL_PREVIEW_STATE_DIR points to external test state, which is intentionally outside this repository. The default is the recorded work/powell-enhanced-preview evidence directory. Re-running requires a fresh one-use redirect URL for the unsubmitted preview cart. Customer credentials and redirect tokens are not copied into this repository. Do not point a live store custom checkout setting at this prototype.

## Verified result

Enhanced desktop (1440px) and mobile (390px) rendering passed. Native Powell pickup remained selected after edit/continue and reload. Check was selectable, independent Forney billing was saved, and no shipping fields were required. No order was submitted. Forney stock stayed 0 and Powell stayed 2; latest order remained 106 from the earlier authorized SDK test. Store and channel checkout settings and inventory settings matched their baselines.

Build and TypeScript check passed. Focused fulfillment and payment-billing regression tests: 3 suites, 95 tests passed. The unmodified upstream baseline attempted shipping for pickup and reported “Consignment not found”; the pickup adaptation avoided that path and no further page errors were observed.

The preview browser and build watcher were stopped after verification. The unsubmitted test cart remains for inspection.

## Subsequent Forney preview

See FORNEY-POC.md for the later local Forney extension and partial-pass shipping result.
