/** @jest-environment-options {"url":"https://checkout-recovery.example/checkout"} */
/* eslint jsdoc/check-tag-names: ["error", { "definedTags": ["jest-environment-options"] }] */
import { act, screen } from '@testing-library/react';

import { type WarehouseCheckoutConfig } from '../warehouse/config';
import { cancelWarehouseInitialization } from '../warehouse/initialization';
import { RECOVERY_MESSAGE, requireSubmissionReview } from '../warehouse/recovery';

import renderCheckout from './renderCheckout';

jest.mock('./CheckoutApp', () => ({ default: jest.fn(() => null) }));
jest.mock('./wdyr', () => ({ initWhyDidYouRender: jest.fn() }));
jest.mock('../common/bundler', () => ({ configurePublicPath: jest.fn((url) => url) }));

const app = () => require('./CheckoutApp').default as jest.Mock;
const originalFetch = global.fetch;
const originalMode = process.env.WAREHOUSE_CHECKOUT_MODE;
const originalStores = process.env.WAREHOUSE_CHECKOUT_STORES;
let config: WarehouseCheckoutConfig;
let sequence = 0;
let popup: Window;
let open: jest.SpyInstance;
const mount = (checkoutId = config.cartId) =>
    renderCheckout({
        containerId: 'recovery-app',
        checkoutId,
        publicPath: 'https://assets.example/',
    });
const success = () => ({
    ok: true,
    status: 200,
    json: async () => ({
        version: 1,
        cartId: config.cartId,
        revision: config.validation.revision,
        warehouse: config.warehouse,
    }),
});
const recovery = (changes = {}) => ({
    ok: false,
    status: 409,
    json: async () => ({
        version: 1,
        cartId: config.cartId,
        revision: config.validation.revision,
        code: 'SUBMISSION_REVIEW_REQUIRED',
        recovery: { status: 'review_required' },
        ...changes,
    }),
});

async function authorize() {
    await act(async () => screen.getByRole('button', { name: 'Continue securely' }).click());

    await popupReply({ warehouseCheckout: config });
}

async function popupReply(payload: object) {
    const url = new URL(open.mock.calls[open.mock.calls.length - 1][0] as string);

    await act(async () => {
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: 'https://recovery-backend.example',
                source: popup,
                data: {
                    protocol: 'warehouse-initialization-v1',
                    requestId: url.searchParams.get('requestId'),
                    cartId: config.cartId,
                    ...payload,
                },
            }),
        );
    });
}

function expectReview() {
    expect(screen.getByRole('alert')).toHaveTextContent(RECOVERY_MESSAGE);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
    expect(app()).not.toHaveBeenCalled();
}

beforeEach(() => {
    config = {
        version: 1,
        preview: true,
        cartId: `reload-recovery-${++sequence}`,
        validation: {
            endpoint: 'https://recovery-backend.example/api/warehouse/validate',
            token: 'synthetic-capability',
            revision: 'revision-a',
            expiresAt: 9999999999,
        },
        warehouse: {
            id: 'test',
            label: 'Test warehouse',
            pickupLabel: 'Test pickup',
            locationId: 1,
            pickupMethodId: 1,
            allowShipping: false,
        },
    };
    process.env.WAREHOUSE_CHECKOUT_MODE = 'staging';
    process.env.WAREHOUSE_CHECKOUT_STORES = JSON.stringify([
        {
            checkoutOrigin: window.location.origin,
            validationEndpoint: config.validation.endpoint,
            initializationEndpoint: 'https://recovery-backend.example/warehouse-initialize/',
        },
    ]);
    delete window.warehouseCheckout;
    window.localStorage.clear();
    document.body.innerHTML = '<div id="recovery-app"></div>';
    app().mockClear();
    popup = { close: jest.fn(), closed: false } as unknown as Window;
    open = jest.spyOn(window, 'open').mockReturnValue(popup);
    global.fetch = jest.fn().mockImplementation(async () => success());
});
afterEach(() => {
    cancelWarehouseInitialization();
    delete window.warehouseCheckout;
    window.localStorage.clear();
    global.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.WAREHOUSE_CHECKOUT_MODE;
    else process.env.WAREHOUSE_CHECKOUT_MODE = originalMode;
    if (originalStores === undefined) delete process.env.WAREHOUSE_CHECKOUT_STORES;
    else process.env.WAREHOUSE_CHECKOUT_STORES = originalStores;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});
it('shows authenticated server recovery on first entry without a browser hint, and preserves it after reload', async () => {
    global.fetch = jest.fn().mockImplementation(async () => recovery());
    expect(window.localStorage.length).toBe(0);
    await act(async () => mount());
    await authorize();
    expectReview();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
        cartId: config.cartId,
        revision: config.validation.revision,
    });
    delete window.warehouseCheckout;
    document.body.innerHTML = '<div id="recovery-app"></div>';
    await act(async () => mount());
    await authorize();
    expectReview();
    // An existing hint blocks before any new validator or payment call.
    expect(global.fetch).toHaveBeenCalledTimes(1);
});
it.each(['success', 'offline'])(
    'a persisted hint blocks cold initialization even if validation would return %s',
    async (kind) => {
        window.localStorage.setItem(
            `warehouse-submission-recovery:v1:${config.validation.endpoint}:${config.cartId}`,
            'attempted',
        );
        if (kind === 'offline')
            global.fetch = jest.fn().mockRejectedValue(new TypeError('offline'));
        await act(async () => mount());
        await authorize();
        expectReview();
        expect(global.fetch).not.toHaveBeenCalled();
    },
);
it('server recovery remains visible when local storage is unavailable', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage denied');
    });
    global.fetch = jest.fn().mockImplementation(async () => recovery());
    await act(async () => mount());
    await authorize();
    expectReview();
});
it.each([
    [
        503,
        'RECOVERY_UNAVAILABLE',
        'We can’t verify your order status right now. Do not submit again. Contact the store for help.',
    ],
    [503, 'UNAVAILABLE', 'Warehouse checkout is unavailable. Return to your cart and try again.'],
    [
        500,
        'RECOVERY_UNAVAILABLE',
        'Warehouse checkout is unavailable. Return to your cart and try again.',
    ],
] as const)('shows the appropriate guidance for %i %s', async (status, code, expected) => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ code }),
    });
    window.warehouseCheckout = config;
    await act(async () => mount());

    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    expect(app()).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
});

it('an ordinary pre-attempt network failure retains authorization retry and can recover', async () => {
    global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockImplementation(async () => success());
    await act(async () => mount());
    await authorize();
    expect(screen.getByRole('alert')).not.toHaveTextContent(RECOVERY_MESSAGE);
    expect(app()).not.toHaveBeenCalled();
    await act(async () =>
        screen.getByRole('button', { name: 'Retry warehouse authorization' }).click(),
    );
    await authorize();
    expect(app()).toHaveBeenCalledTimes(1);
    expect(window.warehouseCheckout?.preview).toBe(true);
});
it('a hint for a different cart does not block a fresh cart', async () => {
    window.localStorage.setItem(
        `warehouse-submission-recovery:v1:${config.validation.endpoint}:other-cart`,
        'attempted',
    );
    await act(async () => mount());
    await authorize();
    expect(app()).toHaveBeenCalledTimes(1);
});
it('a mismatched server recovery response stays blocked but is not treated as authenticated recovery', async () => {
    global.fetch = jest.fn().mockImplementation(async () => recovery({ cartId: 'other-cart' }));
    await act(async () => mount());
    await authorize();
    expect(app()).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent(RECOVERY_MESSAGE);
    expect(
        screen.getByRole('button', { name: 'Retry warehouse authorization' }),
    ).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
});
it('does not mount if another tab marks recovery while successful validation is pending', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
        requireSubmissionReview(config);

        return success();
    });
    await act(async () => mount());
    await authorize();
    expectReview();
});
it('a delayed recovery response for an old initialization cannot replace a newer cart screen', async () => {
    const previous = config;
    let finish: ((value: unknown) => void) | undefined;

    global.fetch = jest
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        )
        .mockImplementation(async () => success());
    window.warehouseCheckout = previous;
    await act(async () => mount());
    config = {
        ...previous,
        cartId: 'replacement-recovery-cart',
        validation: { ...previous.validation, token: 'replacement' },
    };
    window.warehouseCheckout = config;
    await act(async () => mount());
    expect(app()).toHaveBeenCalledTimes(1);
    await act(async () => {
        if (!finish) throw new Error('Missing test callback');
        finish({
            ok: false,
            status: 409,
            json: async () => ({
                version: 1,
                cartId: previous.cartId,
                revision: previous.validation.revision,
                code: 'SUBMISSION_REVIEW_REQUIRED',
                recovery: { status: 'review_required' },
            }),
        });
    });
    expect(app()).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('displays the authenticated shortage after reload and mounts after a single successful retry', async () => {
    const message = 'Test item: 0 available at North; 1 requested.';

    await act(async () =>
        renderCheckout({
            containerId: 'recovery-app',
            checkoutId: config.cartId,
            initialState: {},
        }),
    );
    await act(async () => screen.getByRole('button', { name: 'Continue securely' }).click());
    await popupReply({ error: 'INVENTORY_CONFLICT', message });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(app()).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => screen.getByRole('button', { name: 'Retry verification' }).click());
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Continue securely')).not.toBeInTheDocument();
    await popupReply({ warehouseCheckout: config });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(app()).toHaveBeenCalledTimes(1);
    expect(app().mock.calls[0][0].initialState).toBeUndefined();
    expect(app().mock.calls[0][0].resolvedStockWarning).toBe(message);
});
