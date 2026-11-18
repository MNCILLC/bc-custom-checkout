/** @jest-environment-options {"url":"https://checkout-a.example/checkout"} */
/* eslint jsdoc/check-tag-names: ["error", { "definedTags": ["jest-environment-options"] }] */
import { act, screen } from '@testing-library/react';

import { type WarehouseCheckoutConfig } from '../warehouse/config';
import { submitWithWarehouseValidation } from '../warehouse/submission';

import renderCheckout from './renderCheckout';

jest.mock('./CheckoutApp', () => ({ default: jest.fn(() => null) }));
jest.mock('./wdyr', () => ({ initWhyDidYouRender: jest.fn() }));
jest.mock('../common/bundler', () => ({ configurePublicPath: jest.fn((url) => url) }));

const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'cart-a',
    validation: {
        endpoint: 'https://store-a.example/api/warehouse/validate',
        token: 'synthetic-capability',
        revision: 'revision-a',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'north',
        label: 'North',
        pickupLabel: 'Collect North',
        locationId: 17,
        pickupMethodId: 29,
        allowShipping: false,
    },
};
const stores = [
    {
        checkoutOrigin: 'https://checkout-a.example',
        validationEndpoint: config.validation.endpoint,
    },
];
const originalFetch = global.fetch;
const originalMode = process.env.WAREHOUSE_CHECKOUT_MODE;
const originalStores = process.env.WAREHOUSE_CHECKOUT_STORES;
const mount = () =>
    renderCheckout({
        containerId: 'app',
        checkoutId: 'cart-a',
        publicPath: 'https://assets.example/',
    });
const app = () => require('./CheckoutApp').default as jest.Mock;

beforeEach(() => {
    process.env.WAREHOUSE_CHECKOUT_MODE = 'staging';
    process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify(stores);
    window.warehouseCheckout = JSON.parse(JSON.stringify(config)) as WarehouseCheckoutConfig;
    document.body.innerHTML = '<div id="app"></div>';
    app().mockClear();
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            version: 1,
            cartId: config.cartId,
            revision: config.validation.revision,
            warehouse: config.warehouse,
        }),
    });
});
afterEach(() => {
    delete window.warehouseCheckout;
    global.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.WAREHOUSE_CHECKOUT_MODE;
    else process.env.WAREHOUSE_CHECKOUT_MODE = originalMode;
    if (originalStores === undefined) delete process.env.WAREHOUSE_CHECKOUT_STORES;
    else process.env.WAREHOUSE_CHECKOUT_STORES = originalStores;
    document.body.innerHTML = '';
});
it('mounts only after an authenticated validation response', async () => {
    await act(async () => {
        mount();
        expect(app()).not.toHaveBeenCalled();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(app()).toHaveBeenCalledTimes(1);
});
it.each([
    'missing',
    'null',
    'malformed',
    'wrong-cart',
    'expired',
    'purchasable',
    'wrong-validator',
    'unknown-origin',
])('blocks %s initialization before mounting the SDK app', async (failure) => {
    const value = window.warehouseCheckout;

    if (!value) throw new Error('Missing test fixture');
    if (failure === 'missing') delete window.warehouseCheckout;
    else if (failure === 'null')
        window.warehouseCheckout = null as unknown as WarehouseCheckoutConfig;
    else if (failure === 'malformed') window.warehouseCheckout = {} as WarehouseCheckoutConfig;
    else if (failure === 'wrong-cart') value.cartId = 'other-cart';
    else if (failure === 'expired') value.validation.expiresAt = 1;
    else if (failure === 'purchasable') Object.assign(value, { preview: false });
    else if (failure === 'wrong-validator')
        value.validation.endpoint = 'https://other.example/validate';
    else
        process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify([
            { ...stores[0], checkoutOrigin: 'https://checkout-b.example' },
        ]);
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
});
it.each([401, 409, 503])('blocks server rejection %s', async (status) => {
    global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status, json: async () => ({ message: 'Rejected' }) });
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('does not mount after validation cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('offline'));
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('removal of the handoff cannot fall back to ordinary submission', async () => {
    delete window.warehouseCheckout;

    const prepare = jest.fn();
    const execute = jest.fn();

    await expect(submitWithWarehouseValidation({} as never, prepare, execute)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
});
it('keeps DOM purchase guards active even when initialization is missing', async () => {
    delete window.warehouseCheckout;
    await act(async () => mount());

    const form = document.createElement('form');

    form.innerHTML = '<button id="checkout-payment-continue" type="submit">Place order</button>';
    document.body.appendChild(form);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const submit = new Event('submit', { bubbles: true, cancelable: true });

    screen.getByRole('button', { name: 'Place order' }).dispatchEvent(click);
    form.dispatchEvent(submit);
    expect(click.defaultPrevented).toBe(true);
    expect(submit.defaultPrevented).toBe(true);
});

it('a superseded initialization cannot remount checkout when its response arrives late', async () => {
    let finishFirst: ((value: unknown) => void) | undefined;
    const response = {
        ok: true,
        json: async () => ({
            version: 1,
            cartId: config.cartId,
            revision: config.validation.revision,
            warehouse: config.warehouse,
        }),
    };

    global.fetch = jest
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishFirst = resolve;
                }),
        )
        .mockResolvedValue(response);
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    await act(async () => mount());
    expect(app()).toHaveBeenCalledTimes(1);
    await act(async () => {
        if (!finishFirst) throw new Error('Missing test callback');
        finishFirst(response);
    });
    expect(app()).toHaveBeenCalledTimes(1);
});
it('rejects removal of the handoff while initial validation is pending', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
        delete window.warehouseCheckout;

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: config.cartId,
                revision: config.validation.revision,
                warehouse: config.warehouse,
            }),
        };
    });
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('rejects an in-place credential replacement while initialization is pending', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
        if (!window.warehouseCheckout) throw new Error('Missing test fixture');
        window.warehouseCheckout.validation.token = 'replacement-token';

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: config.cartId,
                revision: config.validation.revision,
                warehouse: config.warehouse,
            }),
        };
    });
    await act(async () => mount());
    expect(app()).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('authorizes without runner injection, validates on the server, then mounts with purchases blocked', async () => {
    delete window.warehouseCheckout;
    process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify([
        { ...stores[0], initializationEndpoint: 'https://store-a.example/warehouse-initialize/' },
    ]);

    const popup = { close: jest.fn(), closed: false } as unknown as Window;
    const open = jest.spyOn(window, 'open').mockReturnValue(popup);

    try {
        await act(async () => mount());
        expect(app()).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        await act(async () => screen.getByRole('button', { name: 'Continue securely' }).click());

        const url = new URL(open.mock.calls[0][0] as string);

        await act(async () => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: 'https://store-a.example',
                    source: popup,
                    data: {
                        protocol: 'warehouse-initialization-v1',
                        requestId: url.searchParams.get('requestId'),
                        cartId: config.cartId,
                        warehouseCheckout: config,
                    },
                }),
            );
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(app()).toHaveBeenCalledTimes(1);
        expect(window.warehouseCheckout).toMatchObject({ preview: true });

        const form = document.createElement('form');

        form.innerHTML = '<button id="checkout-payment-continue">Place order</button>';
        document.body.appendChild(form);

        const event = new Event('submit', { bubbles: true, cancelable: true });

        form.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    } finally {
        open.mockRestore();
    }
});
it('runner-independent initialization still blocks stale server authorization and allows a fresh retry', async () => {
    delete window.warehouseCheckout;
    process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify([
        { ...stores[0], initializationEndpoint: 'https://store-a.example/warehouse-initialize/' },
    ]);

    const popup = { close: jest.fn(), closed: false } as unknown as Window;
    const open = jest.spyOn(window, 'open').mockReturnValue(popup);

    global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ message: 'Stale warehouse' }) });

    try {
        await act(async () => mount());
        await act(async () => screen.getByRole('button', { name: 'Continue securely' }).click());

        const url = new URL(open.mock.calls[0][0] as string);

        await act(async () =>
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: 'https://store-a.example',
                    source: popup,
                    data: {
                        protocol: 'warehouse-initialization-v1',
                        requestId: url.searchParams.get('requestId'),
                        cartId: config.cartId,
                        warehouseCheckout: config,
                    },
                }),
            ),
        );
        expect(app()).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        await act(async () =>
            screen.getByRole('button', { name: 'Retry warehouse authorization' }).click(),
        );
        expect(window.warehouseCheckout).toBeUndefined();
        expect(screen.getByRole('button', { name: 'Continue securely' })).toBeInTheDocument();
    } finally {
        open.mockRestore();
    }
});
