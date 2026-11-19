'use strict';

const { createHash } = require('node:crypto');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIMIT = 50;
const GUIDANCE =
    'Do not submit again or clear the recovery record. An operator must review the order and payment outcome. No matching order is not proof that payment failed.';

class ReadError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function configuration(input) {
    const config = { timeoutMs: 10000, maxPages: 10, ...input };
    if (
        !/^[a-z0-9]{2,20}$/.test(config.storeHash || '') ||
        !Number.isSafeInteger(config.channelId) ||
        config.channelId < 1 ||
        !/^[a-zA-Z0-9:_-]{1,80}$/.test(config.namespace || '') ||
        typeof config.bigcommerceToken !== 'string' ||
        !config.bigcommerceToken.trim() ||
        typeof config.redisToken !== 'string' ||
        !config.redisToken.trim() ||
        !Number.isInteger(config.timeoutMs) ||
        config.timeoutMs < 1 ||
        config.timeoutMs > 60000 ||
        !Number.isInteger(config.maxPages) ||
        config.maxPages < 1 ||
        config.maxPages > 100
    ) {
        throw new ReadError('INVALID_CONFIGURATION');
    }
    let redis;
    try {
        redis = new URL(config.redisUrl);
    } catch {
        throw new ReadError('INVALID_REDIS_URL');
    }
    if (
        redis.protocol !== 'https:' ||
        !redis.hostname.endsWith('.upstash.io') ||
        redis.username ||
        redis.password ||
        redis.port ||
        redis.search ||
        redis.hash ||
        redis.pathname !== '/'
    ) {
        throw new ReadError('INVALID_REDIS_URL');
    }
    return { ...config, redisUrl: redis.origin };
}

function attemptKey(config, cartId) {
    return `${config.namespace}:check-test:v1:${createHash('sha256')
        .update(JSON.stringify([config.storeHash, config.channelId, cartId]))
        .digest('hex')}`;
}

function decodeRecord(raw, cartId) {
    if (raw === null) return { kind: 'absent' };
    let value;
    try {
        value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return { kind: 'unrecognized' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return { kind: 'unrecognized' };
    if (
        value.type === 'simulated_recovery_rehearsal' &&
        value.simulated === true &&
        value.cartId === cartId
    ) {
        return {
            kind: 'simulated',
            note: 'Explicit simulated fixture marker; this record does not represent a real submission.',
        };
    }
    if (
        typeof value.grantId === 'string' &&
        value.grantId &&
        typeof value.fingerprint === 'string' &&
        value.fingerprint &&
        Number.isSafeInteger(value.claimedAt) &&
        value.claimedAt > 0 &&
        value.claimedAt < 8640000000000000
    ) {
        return {
            kind: 'submission_attempt',
            claimedAt: new Date(value.claimedAt).toISOString(),
            note: 'A claim records permission consumed, not proof that an order or payment succeeded.',
        };
    }
    return { kind: 'unrecognized' };
}

function scalar(value) {
    return ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}
function orderSummary(order) {
    return {
        id: order.id,
        cartId: order.cart_id,
        channelId: order.channel_id,
        status: scalar(order.status),
        paymentMethod: scalar(order.payment_method),
        paymentStatus: scalar(order.payment_status),
        total: scalar(order.total_inc_tax),
        currency: scalar(order.currency_code),
        deleted: order.is_deleted === true,
    };
}
function transactionSummary(value) {
    return {
        id: value.id,
        event: scalar(value.event),
        status: scalar(value.status),
        test: typeof value.test === 'boolean' ? value.test : null,
        gateway: scalar(value.gateway),
        amount: scalar(value.amount),
        currency: scalar(value.currency),
        createdAt: scalar(value.date_created),
    };
}

// This module performs only HTTPS GETs to fixed BigCommerce reads and Upstash GET.
// The injected transport is for isolated tests, never supplied through the CLI.
function createReconciler(input, transport = global.fetch) {
    const config = configuration(input);
    const base = `https://api.bigcommerce.com/stores/${config.storeHash}`;
    async function read(url, headers) {
        try {
            const response = await transport(url, {
                method: 'GET',
                headers: { Accept: 'application/json', ...headers },
                redirect: 'error',
                cache: 'no-store',
                signal: AbortSignal.timeout(config.timeoutMs),
            });
            if (!response.ok) throw new ReadError(`HTTP_${response.status}`);
            if (response.status === 204) return [];
            try {
                return await response.json();
            } catch (error) {
                if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
                throw new ReadError('INVALID_JSON');
            }
        } catch (error) {
            if (error instanceof ReadError) throw error;
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
                throw new ReadError('TIMEOUT');
            throw new ReadError('NETWORK_ERROR');
        }
    }
    const bc = (path) => read(base + path, { 'X-Auth-Token': config.bigcommerceToken });
    async function claim(cartId) {
        const data = await read(
            `${config.redisUrl}/get/${encodeURIComponent(attemptKey(config, cartId))}`,
            { Authorization: `Bearer ${config.redisToken}` },
        );
        if (!data || !Object.hasOwn(data, 'result') || Object.hasOwn(data, 'error'))
            throw new ReadError('INVALID_RECOVERY_RESPONSE');
        return data.result;
    }
    async function transactions(orderId) {
        const rows = [];
        const seen = new Set();
        let expectedTotal;
        for (let page = 1; page <= config.maxPages; page++) {
            const data = await bc(`/v3/orders/${orderId}/transactions?page=${page}&limit=${LIMIT}`);
            const pagination = data?.meta?.pagination;
            if (
                !Array.isArray(data?.data) ||
                data.data.length > LIMIT ||
                !pagination ||
                pagination.current_page !== page ||
                pagination.count !== data.data.length ||
                pagination.per_page !== LIMIT ||
                !Number.isSafeInteger(pagination.total) ||
                pagination.total < 0 ||
                !Number.isSafeInteger(pagination.total_pages) ||
                pagination.total_pages < 0 ||
                pagination.total_pages !== Math.ceil(pagination.total / LIMIT) ||
                (expectedTotal !== undefined && pagination.total !== expectedTotal)
            )
                throw new ReadError('INCOMPLETE_TRANSACTIONS');
            expectedTotal = pagination.total;
            for (const row of data.data) {
                if (
                    !row ||
                    !['string', 'number'].includes(typeof row.id) ||
                    String(row.order_id) !== String(orderId) ||
                    seen.has(String(row.id))
                )
                    throw new ReadError('INVALID_TRANSACTION_SCOPE');
                seen.add(String(row.id));
                rows.push(transactionSummary(row));
            }
            if (page >= pagination.total_pages) {
                if (rows.length !== pagination.total)
                    throw new ReadError('INCOMPLETE_TRANSACTIONS');
                return rows;
            }
        }
        throw new ReadError('TRANSACTION_PAGE_LIMIT');
    }
    return async function reconcile(cartId) {
        if (typeof cartId !== 'string' || !GUID.test(cartId))
            throw new ReadError('INVALID_CART_ID');
        const report = {
            version: 1,
            observedAt: new Date().toISOString(),
            storeHash: config.storeHash,
            channelId: config.channelId,
            cartId,
            outcome: 'unable_to_determine',
            retryAuthorized: false,
            guidance: GUIDANCE,
            recovery: { kind: 'unavailable' },
            orders: [],
            errors: [],
            orderSearch: {
                complete: false,
                pages: 0,
                scope: 'API-visible orders filtered by cart_id, verified against channel; point-in-time observation, not a payment-failure guarantee.',
            },
        };
        let before;
        let recordRead = false;
        try {
            before = await claim(cartId);
            recordRead = true;
            report.recovery = decodeRecord(before, cartId);
            if (report.recovery.kind === 'unrecognized')
                report.errors.push({ source: 'recovery', code: 'UNRECOGNIZED_RECORD' });
        } catch (error) {
            report.errors.push({ source: 'recovery', code: error.code });
        }
        const seen = new Set();
        try {
            for (let page = 1; page <= config.maxPages; page++) {
                const rows = await bc(
                    `/v2/orders?cart_id=${encodeURIComponent(cartId)}&sort=id:asc&page=${page}&limit=${LIMIT}`,
                );
                report.orderSearch.pages++;
                if (!Array.isArray(rows) || rows.length > LIMIT)
                    throw new ReadError('INVALID_ORDER_RESPONSE');
                for (const row of rows) {
                    if (
                        !row ||
                        !Number.isSafeInteger(row.id) ||
                        row.id < 1 ||
                        row.cart_id !== cartId ||
                        row.channel_id !== config.channelId ||
                        seen.has(row.id)
                    )
                        throw new ReadError('INVALID_ORDER_SCOPE');
                    seen.add(row.id);
                    report.orders.push({
                        ...orderSummary(row),
                        transactions: null,
                        transactionsComplete: false,
                    });
                }
                if (rows.length < LIMIT) {
                    report.orderSearch.complete = true;
                    break;
                }
            }
            if (!report.orderSearch.complete) throw new ReadError('ORDER_PAGE_LIMIT');
        } catch (error) {
            report.errors.push({ source: 'orders', code: error.code });
        }
        for (const order of report.orders) {
            try {
                order.transactions = await transactions(order.id);
                order.transactionsComplete = true;
            } catch (error) {
                report.errors.push({ source: 'transactions', orderId: order.id, code: error.code });
            }
        }
        if (recordRead) {
            try {
                if (JSON.stringify(await claim(cartId)) !== JSON.stringify(before))
                    report.errors.push({ source: 'recovery', code: 'RECORD_CHANGED_DURING_READ' });
            } catch (error) {
                report.errors.push({ source: 'recoveryRecheck', code: error.code });
            }
        }
        if (report.orders.length > 1)
            report.errors.push({ source: 'orders', code: 'MULTIPLE_MATCHING_ORDERS' });
        if (report.recovery.kind === 'simulated' && report.orders.length)
            report.errors.push({ source: 'recovery', code: 'SIMULATED_RECORD_HAS_ORDER' });
        if (!report.errors.length && report.orderSearch.complete)
            report.outcome = report.orders.length ? 'order_found' : 'no_matching_order_found';
        report.label = {
            order_found: 'Order found',
            no_matching_order_found: 'No matching order found',
            unable_to_determine: 'Unable to determine',
        }[report.outcome];
        report.completedAt = new Date().toISOString();
        return report;
    };
}
module.exports = { createReconciler, attemptKey, ReadError };
