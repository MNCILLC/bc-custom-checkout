'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createReconciler, attemptKey } = require('./reconcile.cjs');
const cart = '11111111-1111-4111-8111-111111111111';
const config = {
    storeHash: 'synthetic',
    channelId: 37,
    namespace: 'test-recovery',
    bigcommerceToken: 'fake-bc-secret',
    redisUrl: 'https://fixture.upstash.io',
    redisToken: 'fake-redis-secret',
};
const record = JSON.stringify({
    grantId: 'private-grant',
    fingerprint: 'private-fingerprint',
    claimedAt: 1700000000000,
});
const order = {
    id: 112,
    cart_id: cart,
    channel_id: 37,
    status: 'Awaiting Fulfillment',
    payment_method: 'Test Payment Provider',
    payment_status: 'captured',
    total_inc_tax: '50.0000',
    currency_code: 'USD',
    billing_address: { email: 'private@example.com' },
};
const transaction = {
    id: 1,
    order_id: '112',
    event: 'purchase',
    status: 'ok',
    test: true,
    amount: 50,
    currency: 'USD',
    credit_card: { card_number: 'private-card' },
    payment_instrument_token: 'private-instrument',
};
function tx(data = [transaction], page = 1, total = data.length) {
    return {
        data,
        meta: {
            pagination: {
                current_page: page,
                count: data.length,
                per_page: 50,
                total,
                total_pages: Math.ceil(total / 50),
            },
        },
    };
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status });
}
function harness(options = {}) {
    const calls = [];
    let claims = 0;
    const transport = async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, init });
        assert.equal(init.method, 'GET');
        assert.equal(init.body, undefined);
        assert.equal(init.redirect, 'error');
        if (parsed.hostname === 'fixture.upstash.io') {
            assert.equal(decodeURIComponent(parsed.pathname), `/get/${attemptKey(config, cart)}`);
            claims++;
            return options.claim ? options.claim(claims) : json({ result: record });
        }
        assert.equal(parsed.hostname, 'api.bigcommerce.com');
        if (parsed.pathname === '/stores/synthetic/v2/orders') {
            assert.equal(parsed.searchParams.get('cart_id'), cart);
            return options.orders
                ? options.orders(Number(parsed.searchParams.get('page')))
                : json([order]);
        }
        assert.match(parsed.pathname, /^\/stores\/synthetic\/v3\/orders\/\d+\/transactions$/);
        return options.transactions
            ? options.transactions(
                  Number(parsed.searchParams.get('page')),
                  Number(parsed.pathname.split('/')[5]),
              )
            : json(tx());
    };
    return {
        run: () => createReconciler({ ...config, ...options.config }, transport)(cart),
        calls,
    };
}
function uncertain(report, code) {
    assert.equal(report.outcome, 'unable_to_determine');
    assert.equal(report.retryAuthorized, false);
    assert.ok(
        report.errors.some((error) => error.code === code),
        JSON.stringify(report.errors),
    );
}

test('finds Test provider order, reads twice, projects no customer/card/claim secrets', async () => {
    const h = harness();
    const result = await h.run();
    assert.equal(result.outcome, 'order_found');
    assert.equal(result.retryAuthorized, false);
    assert.equal(result.recovery.kind, 'submission_attempt');
    assert.equal(result.orders[0].transactions[0].test, true);
    assert.equal(h.calls.length, 4);
    assert.doesNotMatch(
        JSON.stringify(result),
        /private-|fake-|billing_address|credit_card|payment_instrument/,
    );
});
test('Check order with zero transactions is found without declaring paid', async () => {
    const result = await harness({
        orders: () => json([{ ...order, payment_method: 'Check', payment_status: '' }]),
        transactions: () => json(tx([])),
    }).run();
    assert.equal(result.outcome, 'order_found');
    assert.equal(result.orders[0].paymentStatus, '');
    assert.deepEqual(result.orders[0].transactions, []);
});
test('simulated recovery with no order never allows retry', async () => {
    const result = await harness({
        claim: () =>
            json({
                result: JSON.stringify({
                    type: 'simulated_recovery_rehearsal',
                    simulated: true,
                    cartId: cart,
                }),
            }),
        orders: () => json([]),
    }).run();
    assert.equal(result.outcome, 'no_matching_order_found');
    assert.equal(result.recovery.kind, 'simulated');
    assert.equal(result.retryAuthorized, false);
    assert.match(result.guidance, /not proof/);
});
test('absent recovery and HTTP 204 order result are not proof of payment failure', async () => {
    const result = await harness({
        claim: () => json({ result: null }),
        orders: () => new Response(null, { status: 204 }),
    }).run();
    assert.equal(result.outcome, 'no_matching_order_found');
    assert.equal(result.recovery.kind, 'absent');
    assert.equal(result.retryAuthorized, false);
});
for (const value of [
    'invalid-json',
    'null',
    '{}',
    JSON.stringify({ simulated: true, type: 'simulated_recovery_rehearsal', cartId: 'wrong' }),
]) {
    test(`unrecognized recovery record ${value}`, async () =>
        uncertain(
            await harness({ claim: () => json({ result: value }) }).run(),
            'UNRECOGNIZED_RECORD',
        ));
}
test('simulation marker with real order is a conflict', async () =>
    uncertain(
        await harness({
            claim: () =>
                json({
                    result: { type: 'simulated_recovery_rehearsal', simulated: true, cartId: cart },
                }),
        }).run(),
        'SIMULATED_RECORD_HAS_ORDER',
    ));
for (const status of [401, 403, 404, 429, 500]) {
    test(`orders HTTP ${status} is not a clean no-match`, async () =>
        uncertain(
            await harness({ orders: () => json({ private: 'secret-body' }, status) }).run(),
            `HTTP_${status}`,
        ));
}
test('Redis failure retains order evidence', async () => {
    const result = await harness({ claim: () => json({}, 503) }).run();
    uncertain(result, 'HTTP_503');
    assert.equal(result.orders[0].id, 112);
});
test('transaction failure retains order evidence', async () => {
    const result = await harness({ transactions: () => json({}, 500) }).run();
    uncertain(result, 'HTTP_500');
    assert.equal(result.orders[0].transactionsComplete, false);
});
for (const change of [{ cart_id: 'wrong' }, { channel_id: 38 }]) {
    test(`rejects mismatched order ${JSON.stringify(change)}`, async () =>
        uncertain(
            await harness({ orders: () => json([{ ...order, ...change }]) }).run(),
            'INVALID_ORDER_SCOPE',
        ));
}
test('multiple matching orders need review', async () =>
    uncertain(
        await harness({
            orders: () => json([order, { ...order, id: 113 }]),
            transactions: () => json(tx([])),
        }).run(),
        'MULTIPLE_MATCHING_ORDERS',
    ));
test('duplicate order IDs are rejected', async () =>
    uncertain(await harness({ orders: () => json([order, order]) }).run(), 'INVALID_ORDER_SCOPE'));
test('complete paginated transaction list is collected', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...transaction, id: index + 1 }));
    const result = await harness({
        transactions: (page) => json(tx(rows.slice((page - 1) * 50, page * 50), page, 51)),
    }).run();
    assert.equal(result.outcome, 'order_found');
    assert.equal(result.orders[0].transactions.length, 51);
});
for (const body of [
    { data: [] },
    tx([], 1, 1),
    tx([transaction], 2, 1),
    { ...tx(), meta: { pagination: { ...tx().meta.pagination, per_page: 25 } } },
]) {
    test(`incomplete transaction metadata ${JSON.stringify(body.meta)}`, async () =>
        uncertain(
            await harness({ transactions: () => json(body) }).run(),
            'INCOMPLETE_TRANSACTIONS',
        ));
}
test('transaction must belong to matched order', async () =>
    uncertain(
        await harness({
            transactions: () => json(tx([{ ...transaction, order_id: '113' }])),
        }).run(),
        'INVALID_TRANSACTION_SCOPE',
    ));
test('order page cap fails closed', async () =>
    uncertain(
        await harness({
            config: { maxPages: 1 },
            orders: () => json(Array.from({ length: 50 }, (_, id) => ({ ...order, id: id + 1 }))),
            transactions: () => json(tx([])),
        }).run(),
        'ORDER_PAGE_LIMIT',
    ));
test('transaction page cap fails closed', async () =>
    uncertain(
        await harness({
            config: { maxPages: 1 },
            transactions: () =>
                json(
                    tx(
                        Array.from({ length: 50 }, (_, id) => ({ ...transaction, id })),
                        1,
                        51,
                    ),
                ),
        }).run(),
        'TRANSACTION_PAGE_LIMIT',
    ));
test('changing record during reads fails closed', async () =>
    uncertain(
        await harness({ claim: (n) => json({ result: n === 1 ? record : null }) }).run(),
        'RECORD_CHANGED_DURING_READ',
    ));
test('malformed response does not echo body', async () => {
    const result = await harness({ orders: () => new Response('secret-body') }).run();
    uncertain(result, 'INVALID_JSON');
    assert.doesNotMatch(JSON.stringify(result), /secret-body/);
});
test('unsafe config and invalid UUID are rejected before network', async () => {
    let count = 0;
    const transport = () => {
        count++;
        throw Error('unexpected');
    };
    for (const change of [
        { redisUrl: 'http://fixture.upstash.io' },
        { redisUrl: 'https://other.example' },
        { redisUrl: 'https://user:pass@fixture.upstash.io' },
        { redisUrl: 'https://fixture.upstash.io/set' },
        { storeHash: '../x' },
        { channelId: NaN },
        { namespace: '' },
        { maxPages: 0 },
    ])
        assert.throws(() => createReconciler({ ...config, ...change }, transport));
    await assert.rejects(createReconciler(config, transport)('invalid-cart'));
    assert.equal(count, 0);
});
test('CLI help and missing configuration do not expose supplied secrets', () => {
    const help = spawnSync(process.execPath, [require.resolve('./index.cjs'), '--help'], {
        encoding: 'utf8',
        env: {},
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /No outcome authorizes retry/);
    const bad = spawnSync(
        process.execPath,
        [require.resolve('./index.cjs'), '--secret=fake-secret'],
        { encoding: 'utf8', env: {} },
    );
    assert.equal(bad.status, 1);
    assert.doesNotMatch(bad.stderr, /fake-secret/);
});
for (const scenario of ['timeout', 'redirect', 'server-error']) {
    test(`real HTTP transport: ${scenario} stays read-only and fails closed`, async () => {
        const methods = [];
        let redirectFollowed = false;
        const server = createServer((req, res) => {
            methods.push(req.method);
            if (req.url.startsWith('/get/')) {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ result: record }));
            } else if (req.url === '/must-not-follow') {
                redirectFollowed = true;
                res.end('[]');
            } else if (scenario === 'redirect') {
                res.writeHead(302, { location: '/must-not-follow' });
                res.end();
            } else if (scenario === 'server-error') {
                res.writeHead(500);
                res.end('secret-body');
            }
            // Timeout deliberately leaves this response pending until the AbortSignal fires.
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const transport = (url, init) => {
                const source = new URL(url);
                return fetch(
                    `http://127.0.0.1:${server.address().port}${source.pathname}${source.search}`,
                    init,
                );
            };
            const result = await createReconciler({ ...config, timeoutMs: 200 }, transport)(cart);
            uncertain(
                result,
                { timeout: 'TIMEOUT', redirect: 'NETWORK_ERROR', 'server-error': 'HTTP_500' }[
                    scenario
                ],
            );
            assert.ok(methods.length >= 2);
            assert.ok(methods.every((method) => method === 'GET'));
            assert.equal(redirectFollowed, false);
            assert.doesNotMatch(JSON.stringify(result), /secret-body/);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    });
}
