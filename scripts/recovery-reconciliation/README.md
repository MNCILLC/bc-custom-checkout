# Read-only recovery reconciliation

Local operator CLI for the standalone checkout repository. Requires Node 24, with no additional packages. It reads the permanent submission-attempt record and BigCommerce orders/transactions for one cart. It does not import Catalyst, run in the browser, enable purchasing, clear claims, change settings, retry submission, or process payments.

## Run

From the checkout repository, provide credentials in a private file outside the repository:

```sh
node --env-file=/absolute/private/recovery.env \
  scripts/recovery-reconciliation/index.cjs \
  --cart-id CART_UUID \
  --store-hash STORE_HASH \
  --channel-id CHANNEL_ID \
  --namespace REDIS_NAMESPACE
```

Required private environment variables:

- `BIGCOMMERCE_ACCESS_TOKEN`: management API credential that can read orders and transactions. Prefer an Orders read-only credential.
- `WAREHOUSE_REDIS_URL`: the store's HTTPS Upstash REST origin, without a path or query.
- `WAREHOUSE_REDIS_TOKEN`: prefer an Upstash read-only token.

Scope can also come from `BIGCOMMERCE_STORE_HASH`, `BIGCOMMERCE_CHANNEL_ID`, and `WAREHOUSE_REDIS_NAMESPACE`; explicit CLI scope flags take precedence. The namespace must exactly match the backend deployment being investigated. A wrong but valid namespace can return an absent record; the tool cannot discover the intended namespace or prove that an absent record means there was no attempt. Never put these credentials in `NEXT_PUBLIC_*`, checkout public configuration, a committed env file, or CLI arguments. This tool needs no checkout deployment or loader activation.

The existing sandbox credentials can be used without copying them:

```sh
node \
  --env-file=/Users/kylehurt/dev/sandbox-catalyst/catalyst-sandbox-11/.env.local \
  --env-file=/Users/kylehurt/.config/catalyst-rehearsal/hosted-redis.env \
  /Users/kylehurt/dev/bc-apps/bc-custom-checkout/scripts/recovery-reconciliation/index.cjs \
  --cart-id d443aa37-7350-4c44-b1d9-11ef7b443143 \
  --store-hash 3olkgrdpfq \
  --channel-id 1912525 \
  --namespace warehouse-vercel-rehearsal-1912525
```

Node's existing process environment takes precedence over env files. Avoid running from a shell that already exports credentials for another store. The example cart is a retained simulated recovery fixture, not a new purchase. Use a different cart UUID when investigating an actual order. Store, channel and Redis scope are runtime configuration; no sandbox values are embedded in the implementation.

JSON is written to stdout. If saving a report, use `umask 077` before redirecting to a private file. Reports omit customer addresses, email, card details, gateway transaction identifiers, grant IDs, fingerprints, tokens and raw error bodies. Cart IDs and order IDs remain operationally sensitive.

## Interpret the report

| Outcome | Meaning | Exit code |
| --- | --- | --- |
| `order_found` | One matching cart/channel order was found, transaction pagination completed, and the recovery record was stable during the check. | 0 |
| `no_matching_order_found` | The API-visible search completed without a match; the recovery record was stable. This is not proof of a failed payment. | 0 |
| `unable_to_determine` | A read failed, the record changed, a response was incomplete or inconsistent, or conflicting orders/records were found. Review any retained evidence. | 2 |
| No report | Invalid configuration or command arguments; no reconciliation completed. | 1 |

**Every report has `retryAuthorized: false`.** Exit 0 means a completed observation, never permission to retry or proof of settlement. Payment status, transaction event/status and test flag are reported as observed, without guessing whether funds settled. A Check order can exist without a captured electronic payment. An absent or empty transaction list is not authorization to resubmit.

Operator procedure:

1. Confirm the correct store, channel, cart and Redis namespace from the relevant deployment/incident.
2. Run the CLI and retain the timestamped report privately.
3. If an order was found, use that existing order for review. Confirm payment outcome with the relevant provider when necessary; do not resubmit the cart.
4. If there is no match or the outcome is uncertain, keep the cart blocked. Investigate the BigCommerce order/payment records and provider records; API visibility can lag an actual payment. A later read-only recheck is allowed, but this tool never automatically retries even a read.
5. Leave the permanent attempt record intact. Any future support action to resolve a customer incident needs a separate reviewed procedure; this tool does not implement an unlock/reset or a resolution writer.

## Read boundary and limitations

Only HTTPS GET requests are made to BigCommerce's fixed API host and the configured Upstash origin. Redirects are refused, each request has a 10-second timeout, and each collection is capped at 10 pages of 50 items. Reaching a cap without proving completion reports uncertainty. Recovery is read before and after the order/transaction reads; a changed record reports uncertainty.

Orders are requested using `cart_id`, then every result is checked against the exact cart and channel. Transactions must belong to the matching order and have complete, consistent pagination. Multiple matching orders or an explicitly simulated record with an actual order require review. A failure preserves any matched order evidence already collected.

The recovery key matches the current backend's shared Check/Test provider format: `NAMESPACE:check-test:v1:SHA256(JSON.stringify([storeHash, channelId, cartId]))`. This is a versioned adapter contract, not a generic scan of Redis. Existing fixtures with `type: simulated_recovery_rehearsal`, `simulated: true` and the matching `cartId` are explicitly labeled. Arbitrary record shapes are uncertain.

This is a point-in-time observation, not an atomic snapshot of BigCommerce, Redis and the gateway. Deleted/inaccessible orders, delayed transactions and provider-only payment outcomes may not be visible. It does not establish native SDK submission enforcement, authorize a production gateway, or test BigCommerce Payments. The current sandbox evidence covers Check and the Test payment provider only.

## Tests and evidence

```sh
node --test scripts/recovery-reconciliation/reconcile.test.cjs
```

The tests use synthetic credentials and records. They include actual local HTTP transport failures (timeout, redirect and HTTP 500), plus response fixtures for authorization/rate-limit errors, malformed responses, pagination, identity mismatches, changed records, multiple orders and redaction. No real upstream failure or payment is triggered. There is no dependency on Postman CLI or a hosted mock.

On 2026-11-19, the read-only hosted rehearsal matched existing sandbox orders 109, 110, 111 and 112 and identified all three retained simulated carts without matching orders. All seven attempt records remained unchanged. A before/after comparison found the checkout settings and sampled inventory API responses unchanged, with the latest order still 112. The original localhost loader remained configured; public hosted checkout assets still had both test-purchasing opt-ins off. No authorization, claim, payment or order submission was performed.

Provider references: [BigCommerce orders API](https://docs.bigcommerce.com/developer/api-reference/rest/admin/management/orders/get-orders), [order and transaction overview](https://docs.bigcommerce.com/developer/docs/admin/checkout-and-cart/orders/overview), [Upstash REST API](https://upstash.com/docs/redis/features/restapi). See `recovery.context.yaml` for evidence scope and unresolved assumptions.
