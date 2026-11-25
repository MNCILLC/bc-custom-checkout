# Checkout JS
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/bigcommerce/checkout-js)

Checkout JS is a browser-based application providing a seamless UI for BigCommerce shoppers to complete their checkout. It is also known as [Optimized One-Page Checkout](https://support.bigcommerce.com/s/article/Optimized-Single-Page-Checkout), which is currently the recommended checkout option for all BigCommerce stores.

## Requirements

In order to build from the source code, you must have the following set up in your development environment.

* Node >= 24.
* NPM >= v11.
* Unix-based operating system. (WSL on Windows)

One of the simplest ways to install Node is using [NVM](https://github.com/nvm-sh/nvm#installation-and-update). You can follow their instructions to set up your environment if it is not already set up.

## Development

Once you have cloned the repository and set up your environment, you can start developing with it.

First, you have to pull in the dependencies required for the application.

```sh
npm ci
```

After that, you can make changes to the source code and run the following command to build it.

```sh
npm run build
```

If you are developing the application locally and want to build the source code in watch mode, you can run the following command:

```sh
npm run dev
```

If you want to create a prerelease (i.e.: `alpha`) for testing in the integration environment, you can run the following command:

```sh
npm run release:alpha
```

After that, you need to push the prerelease tag to your fork so it can be referenced remotely.

### Testing

To run E2E tests, use the following command:

```sh
npm run e2e
```

The E2E tests in this project use HAR files to stub network calls. If you need to manually update the HAR files to make minor changes to the requests, you must run the command below to regenerate the ID for each updated request. Otherwise, the stubs will not function properly.

```sh
npm run regenerate-har
```

## Custom Checkout installation

Follow [this guide](https://developer.bigcommerce.com/stencil-docs/customizing-checkout/installing-custom-checkouts) for instructions on how to fork and install this app as a Custom Checkout in your store.

If you want to test your checkout implementation, you can run:
```sh
npm run dev:server
```

And enter the local URL for `auto-loader-dev.js` in Checkout Settings, e.g `http://127.0.0.1:8080/auto-loader-dev.js`

To have the page reload itself on every change instead, run `npm run dev:hmr` in place of `npm run dev` and `npm run dev:server`. It serves the same URL. Stylesheet edits apply without a reload.

## Release

Everytime a PR is merged to the master branch, CircleCI will trigger a build automatically. However, it won't create a new Git release until it is approved by a person with write access to the repository. If you have write access, you can approve a release job by going to [CircleCI](https://circleci.com/gh/bigcommerce/workflows/checkout-js/tree/master) and look for the job you wish to approve. You can also navigate directly to the release job by clicking on the yellow dot next to the merged commit.


## Contribution

More information can be found in the [contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) for this project.


Copyright (C) 2019-Present BigCommerce Inc. All rights reserved.
# bc-custom-checkout


### Warehouse Test payment provider rehearsal

The standalone checkout supports a default-off `allowTestProvider` boolean on each `WAREHOUSE_CHECKOUT_STORES` entry. Staging accepts an HTTPS validator. Development accepts this opt-in only in a development build with the validator at `http://localhost:3000`. Restart `npm run dev` after changing the local checkout mapping. By default, staging accepts one payment opt-in at a time. For hosted Sandbox Cowboy, the matching `WAREHOUSE_CHECKOUT_STORES` entry can explicitly select both methods with `allowHostedSandboxCheck: true`, `allowCheckTest: true`, and `allowTestProvider: true`. This combination requires checkout origin `https://sandboxcatalystcheckout.mncillc.com` and validator `https://sandboxcatalyst.mncillc.com/api/warehouse/validate`. Catalyst must independently enable `allowHostedSandboxCheck` in its normal Test-provider policy. Each method still requires its own warehouse-validated grant and shares the same cart attempt record. Local development can also enable `allowCheckTest` for native offline Check when the local validator authorizes it.

An independent backend must return the authenticated `testProviderAuthorization` contract (`version:1`, `methodId:"bigpaypay"`, `testMode:true`, signed `token`, short-lived `expiresAt`) from the configured validator. The native form accepts only the exact Test payment provider, without a gateway override, stored instrument, save-instrument selection, or custom submit callback. It sends only payment identity and instrument-use booleans with the normal warehouse snapshot to claim a single attempt; it never sends card data to the warehouse backend. The response must explicitly acknowledge `testProviderClaimed:true` and the same token before the SDK executor runs.

Backend authorization must bind the store/channel/cart/customer/warehouse/revision/item/quantity/amount/currency, verify that the provider is in test mode, and atomically consume a durable per-cart attempt shared with Check. An absent opt-in or grant keeps preview purchasing blocked. Ambiguous responses and SDK failures consume the attempt; do not retry or reset its claim. Redirect finalization and broader production purchasing remain blocked. Keep this checkout independent of any particular Catalyst deployment.

Rollback after a separately authorized hosted test: restore the channel's original loader, remove the backend test policy and checkout `allowTestProvider` opt-in, redeploy both, verify the block, and retain the attempt record. This does not automatically cancel an order or reverse inventory.
