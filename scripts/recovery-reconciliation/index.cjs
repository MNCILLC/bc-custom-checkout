#!/usr/bin/env node
'use strict';
const { parseArgs } = require('node:util');
const { createReconciler } = require('./reconcile.cjs');

async function main() {
    const { values } = parseArgs({
        options: {
            'cart-id': { type: 'string' },
            'store-hash': { type: 'string' },
            'channel-id': { type: 'string' },
            namespace: { type: 'string' },
            help: { type: 'boolean' },
        },
        allowPositionals: false,
    });
    if (values.help) {
        process.stdout.write(
            'Usage: node [--env-file=/private/recovery.env] scripts/recovery-reconciliation/index.cjs --cart-id UUID [--store-hash HASH --channel-id ID --namespace NAME]\nRead-only JSON report. Exit 0: observation complete; 2: unable to determine; 1: configuration/usage error. No outcome authorizes retry.\nCredentials: BIGCOMMERCE_ACCESS_TOKEN, WAREHOUSE_REDIS_URL, WAREHOUSE_REDIS_TOKEN. Scope: BIGCOMMERCE_STORE_HASH, BIGCOMMERCE_CHANNEL_ID, WAREHOUSE_REDIS_NAMESPACE.\n',
        );
        return;
    }
    const reconcile = createReconciler({
        storeHash: values['store-hash'] || process.env.BIGCOMMERCE_STORE_HASH,
        channelId: Number(values['channel-id'] || process.env.BIGCOMMERCE_CHANNEL_ID),
        namespace: values.namespace || process.env.WAREHOUSE_REDIS_NAMESPACE,
        bigcommerceToken: process.env.BIGCOMMERCE_ACCESS_TOKEN,
        redisUrl: process.env.WAREHOUSE_REDIS_URL,
        redisToken: process.env.WAREHOUSE_REDIS_TOKEN,
    });
    const report = await reconcile(values['cart-id']);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.outcome === 'unable_to_determine' ? 2 : 0;
}
main().catch(() => {
    // Never echo supplied arguments, credentials, upstream bodies or arbitrary exception messages.
    process.stderr.write(
        'Reconciliation could not start. Check the cart ID and private configuration; use --help. No writes were performed.\n',
    );
    process.exitCode = 1;
});
