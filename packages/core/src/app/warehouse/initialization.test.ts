/** @jest-environment-options {"url":"https://checkout.example/checkout"} */
/* eslint jsdoc/check-tag-names: ["error", { "definedTags": ["jest-environment-options"] }] */
import { type WarehouseCheckoutConfig } from './config';
import {
    cancelWarehouseInitialization,
    initializeWarehouseCheckout,
    requestWarehouseInitialization,
} from './initialization';

const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'cart-a',
    validation: {
        endpoint: 'https://store.example/api/warehouse/validate',
        token: 'synthetic-only',
        revision: 'revision-a',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'powell',
        label: 'Powell',
        pickupLabel: 'Pickup Powell',
        locationId: 2,
        pickupMethodId: 3,
        allowShipping: false,
    },
};
const priorMode = process.env.WAREHOUSE_CHECKOUT_MODE;
const priorStores = process.env.WAREHOUSE_CHECKOUT_STORES;
let popup: Window;
let open: jest.SpyInstance;

function respond(overrides = {}, origin = 'https://store.example', source = popup) {
    const url = new URL(open.mock.calls[open.mock.calls.length - 1][0] as string);

    window.dispatchEvent(
        new MessageEvent('message', {
            origin,
            source,
            data: {
                protocol: 'warehouse-initialization-v1',
                requestId: url.searchParams.get('requestId'),
                cartId: 'cart-a',
                warehouseCheckout: config,
                ...overrides,
            },
        }),
    );
}

beforeEach(() => {
    jest.useFakeTimers();
    process.env.WAREHOUSE_CHECKOUT_MODE = 'staging';
    process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify([
        {
            checkoutOrigin: window.location.origin,
            validationEndpoint: config.validation.endpoint,
            initializationEndpoint: 'https://store.example/warehouse-initialize/',
        },
    ]);
    popup = { close: jest.fn(), closed: false } as unknown as Window;
    open = jest.spyOn(window, 'open').mockReturnValue(popup);
    delete window.warehouseCheckout;
});
afterEach(() => {
    cancelWarehouseInitialization();
    jest.useRealTimers();
    open.mockRestore();
    delete window.warehouseCheckout;
    if (priorMode === undefined) delete process.env.WAREHOUSE_CHECKOUT_MODE;
    else process.env.WAREHOUSE_CHECKOUT_MODE = priorMode;
    if (priorStores === undefined) delete process.env.WAREHOUSE_CHECKOUT_STORES;
    else process.env.WAREHOUSE_CHECKOUT_STORES = priorStores;
});
it('requests only non-secret correlation fields and accepts the exact popup and origin', async () => {
    const result = requestWarehouseInitialization('cart-a');
    const url = new URL(open.mock.calls[0][0] as string);

    expect([...url.searchParams.keys()].sort()).toEqual(['cartId', 'checkoutOrigin', 'requestId']);
    expect(url.searchParams.get('requestId')).toMatch(/^[a-f0-9]{64}$/);
    respond();
    await expect(result).resolves.toEqual(config);
    expect(popup.close).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});
it.each(['origin', 'source', 'nonce', 'protocol'])('ignores forged %s messages', async (kind) => {
    const result = requestWarehouseInitialization('cart-a');
    const done = jest.fn();

    void result.then(done);
    if (kind === 'origin') respond({}, 'https://evil.example');
    else if (kind === 'source') respond({}, 'https://store.example', window);
    else if (kind === 'nonce') respond({ requestId: 'wrong' });
    else respond({ protocol: 'wrong' });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    respond();
    await expect(result).resolves.toEqual(config);
});
it.each(['cart', 'expiry', 'validator', 'purchase', 'truthy-preview', 'denied'])(
    'rejects %s responses',
    async (kind) => {
        const result = requestWarehouseInitialization('cart-a');
        const expected = expect(result).rejects.toThrow();
        const value = JSON.parse(JSON.stringify(config)) as WarehouseCheckoutConfig;

        if (kind === 'cart') value.cartId = 'cart-b';
        else if (kind === 'expiry') value.validation.expiresAt = 1;
        else if (kind === 'validator') value.validation.endpoint = 'https://evil.example/validate';
        else if (kind === 'purchase') Object.assign(value, { preview: false });
        else if (kind === 'truthy-preview') Object.assign(value, { preview: 'true' });
        respond({ warehouseCheckout: kind === 'denied' ? undefined : value });
        await expected;
        expect(window.warehouseCheckout).toBeUndefined();
    },
);
it.each(['blocked', 'closed', 'timeout'])('fails closed when popup is %s', async (kind) => {
    if (kind === 'blocked') open.mockReturnValue(null);

    const result = requestWarehouseInitialization('cart-a');
    const expected = expect(result).rejects.toThrow();

    if (kind === 'closed') {
        Object.assign(popup, { closed: true });
        jest.advanceTimersByTime(1000);
    }

    if (kind === 'timeout') jest.advanceTimersByTime(60000);
    await expected;
    expect(jest.getTimerCount()).toBe(0);
});
it('cancels an older request and ignores its late reply', async () => {
    const first = requestWarehouseInitialization('cart-a');
    const expected = expect(first).rejects.toThrow();
    const oldUrl = new URL(open.mock.calls[0][0] as string);
    const second = requestWarehouseInitialization('cart-a');

    await expected;
    respond({ requestId: oldUrl.searchParams.get('requestId') });
    respond();
    await expect(second).resolves.toEqual(config);
});
it('requires a user click and does not install superseded authorization', async () => {
    const container = document.createElement('div');
    let current = true;
    const result = initializeWarehouseCheckout(container, 'cart-a', () => current);
    const expected = expect(result).rejects.toThrow();

    expect(open).not.toHaveBeenCalled();
    container.querySelector('button')?.click();
    current = false;
    respond();
    await expected;
    expect(window.warehouseCheckout).toBeUndefined();
});

describe('local one-click handoff', () => {
    const id = 'a1111111-1111-4111-8111-111111111111';
    let request: jest.SpyInstance;
    const original = process.env;

    beforeEach(() => {
        process.env = {
            ...process.env,
            NODE_ENV: 'development',
            WAREHOUSE_CHECKOUT_MODE: 'development',
            WAREHOUSE_CHECKOUT_STORES: JSON.stringify([
                {
                    checkoutOrigin: window.location.origin,
                    currentCustomerClientId: 'app-public-id',
                    handoffEndpoint: 'https://store.example/api/warehouse/initialize',
                    validationEndpoint: config.validation.endpoint,
                },
            ]),
        };
        history.replaceState(null, '', `/checkout#warehouseHandoff=${id}`);
        request = jest.spyOn(globalThis, 'fetch');
        request.mockResolvedValueOnce(new Response('synthetic-shopper-proof'));
    });
    afterEach(() => {
        request.mockRestore();
        history.replaceState(null, '', '/checkout');
        process.env = original;
    });
    it('initializes directly once across two renders and removes the spent fragment', async () => {
        request.mockResolvedValueOnce(Response.json(config));

        const box = document.createElement('div');
        const obsolete = initializeWarehouseCheckout(box, 'cart-a', () => false);
        const current = initializeWarehouseCheckout(box, 'cart-a', () => true);

        await expect(obsolete).rejects.toThrow('superseded');
        await current;
        expect(box.querySelector('button')).toBeNull();
        expect(open).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[0][0]).toBe(
            'https://checkout.example/customer/current.jwt?app_client_id=app-public-id',
        );
        expect(request.mock.calls[1]).toEqual([
            'https://store.example/api/warehouse/initialize',
            expect.objectContaining({
                credentials: 'omit',
                redirect: 'error',
                headers: expect.objectContaining({
                    Authorization: 'Bearer synthetic-shopper-proof',
                }),
                body: JSON.stringify({ cartId: 'cart-a', handoffId: id }),
            }),
        ]);
        expect(window.warehouseCheckout).toEqual(config);
        expect(window.location.hash).toBe('');
    });
    it('leaves a stale handoff blocked without opening the popup', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 409 }));
        await expect(
            initializeWarehouseCheckout(document.body, 'cart-a', () => true),
        ).rejects.toThrow();
        expect(window.warehouseCheckout).toBeUndefined();
        expect(open).not.toHaveBeenCalled();
        expect(window.location.hash).toContain(id);
    });
});
