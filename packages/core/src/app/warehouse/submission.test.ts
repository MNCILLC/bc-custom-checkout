import { type CheckoutService } from '@bigcommerce/checkout-sdk';

import { type WarehouseCheckoutConfig } from './config';
import { submissionSnapshot, submitWithWarehouseValidation } from './submission';
import { warehouseSubmissionInProgress } from './submissionState';
import { beginWarehouseTransition } from './validation';

const originalFetch = global.fetch;
const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'cart-a',
    validation: {
        endpoint: 'https://validator.example/validate',
        token: 'test-only',
        revision: 'rev-a',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'west',
        label: 'West',
        pickupLabel: 'West pickup',
        locationId: 72,
        pickupMethodId: 83,
        allowShipping: false,
    },
};

function fixture(shipping = false) {
    const checkout = { id: 'cart-a', grandTotal: 50, version: 1 };
    const cart = {
        lineItems: { physicalItems: [{ id: 'item', productId: 91, variantId: 92, quantity: 1 }] },
    };
    const consignments: Array<{
        id: string;
        lineItemIds: string[];
        selectedPickupOption?: { pickupMethodId: number };
        selectedShippingOption?: { id: string; type: string };
    }> = [
        {
            id: 'consignment',
            lineItemIds: ['item'],
            ...(shipping
                ? { selectedShippingOption: { id: 'freight', type: 'shipping_carrier' } }
                : { selectedPickupOption: { pickupMethodId: 83 } }),
        },
    ];
    const service = {
        getState: () => ({
            data: {
                getCheckout: () => checkout,
                getCart: () => cart,
                getConsignments: () => consignments,
                getBillingAddress: () => ({ countryCode: 'US' }),
            },
        }),
        loadCheckout: jest.fn().mockResolvedValue(undefined),
    } as unknown as CheckoutService;
    const execute = jest.fn().mockResolvedValue(undefined);

    return { service, checkout, cart, consignments, execute };
}

beforeEach(() => {
    window.warehouseCheckout = JSON.parse(JSON.stringify(config)) as WarehouseCheckoutConfig;
    global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options?.body as string) as { submission: unknown };

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: 'cart-a',
                revision: 'rev-a',
                warehouse: window.warehouseCheckout?.warehouse,
                submission: body.submission,
            }),
        } as Response;
    });
});
afterEach(() => {
    delete window.warehouseCheckout;
    global.fetch = originalFetch;
});

it.each(['pickup-only', 'origin-pickup', 'origin-shipping'])(
    'verifies %s with configurable IDs but never invokes the real executor in preview',
    async (mode) => {
        const { service, execute } = fixture(mode === 'origin-shipping');

        if (window.warehouseCheckout)
            window.warehouseCheckout.warehouse.allowShipping = mode !== 'pickup-only';
        await expect(
            submitWithWarehouseValidation(service, async () => true, execute),
        ).rejects.toThrow('Preview only');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).submission).toEqual(
            submissionSnapshot(service),
        );
        expect(execute).not.toHaveBeenCalled();
        expect(warehouseSubmissionInProgress()).toBe(false);
    },
);

it('blocks an unfinished consignment without calling the validator or executor', async () => {
    const { service, consignments, execute } = fixture();

    delete consignments[0].selectedPickupOption;
    await expect(submitWithWarehouseValidation(service, async () => true, execute)).rejects.toThrow(
        'Select a delivery',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
});

it.each([401, 409, 503])('blocks submission on server status %s', async (status) => {
    const { service, execute } = fixture();

    global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ message: 'Return to cart' }),
    });
    await expect(submitWithWarehouseValidation(service, async () => true, execute)).rejects.toThrow(
        'Return to cart',
    );
    expect(execute).not.toHaveBeenCalled();
});

it('rejects an old validator that does not acknowledge the submission snapshot', async () => {
    const { service, execute } = fixture();

    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            version: 1,
            cartId: 'cart-a',
            revision: 'rev-a',
            warehouse: config.warehouse,
        }),
    });
    await expect(submitWithWarehouseValidation(service, async () => true, execute)).rejects.toThrow(
        'did not match',
    );
    expect(execute).not.toHaveBeenCalled();
});

it('detects quantity changes found by SDK refresh', async () => {
    const { service, cart, execute } = fixture();

    (service.loadCheckout as jest.Mock).mockImplementation(async () => {
        cart.lineItems.physicalItems[0].quantity = 2;
    });
    await expect(submitWithWarehouseValidation(service, async () => true, execute)).rejects.toThrow(
        'Checkout changed',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
});

it('blocks delivery changes in the same tab during preparation', async () => {
    const { service, execute } = fixture();

    await expect(
        submitWithWarehouseValidation(
            service,
            async () => {
                expect(warehouseSubmissionInProgress()).toBe(true);
                expect(() => beginWarehouseTransition()).toThrow('Wait for checkout verification');

                return true;
            },
            execute,
        ),
    ).rejects.toThrow('Preview only');
    expect(execute).not.toHaveBeenCalled();
});

it('blocks submission during an existing delivery transition', async () => {
    const { service, execute } = fixture();
    const end = beginWarehouseTransition();

    try {
        await expect(
            submitWithWarehouseValidation(service, async () => true, execute),
        ).rejects.toThrow('Wait for your delivery');
        expect(execute).not.toHaveBeenCalled();
    } finally {
        end();
    }
});

it('leaves unconfigured stores on their existing executor path', async () => {
    const { service, execute } = fixture();

    delete window.warehouseCheckout;
    await submitWithWarehouseValidation(service, async () => true, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
});

it('times out an unresponsive validator and releases the submission lock', async () => {
    jest.useFakeTimers();

    const { service, execute } = fixture();

    global.fetch = jest.fn(
        (_url, options) =>
            new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () =>
                    reject(new DOMException('Aborted', 'AbortError')),
                );
            }),
    );

    try {
        const result = expect(
            submitWithWarehouseValidation(service, async () => true, execute),
        ).rejects.toThrow('Cannot reach warehouse verification');

        await jest.advanceTimersByTimeAsync(20001);
        await result;
        expect(execute).not.toHaveBeenCalled();
        expect(warehouseSubmissionInProgress()).toBe(false);
    } finally {
        jest.useRealTimers();
    }
});

it('does not overwrite a newer handoff with an old validation response', async () => {
    const { service, execute } = fixture();

    global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options?.body as string);

        if (window.warehouseCheckout)
            window.warehouseCheckout.validation.revision = 'newer-revision';

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: 'cart-a',
                revision: 'rev-a',
                warehouse: config.warehouse,
                submission: body.submission,
            }),
        } as Response;
    });
    await expect(submitWithWarehouseValidation(service, async () => true, execute)).rejects.toThrow(
        'did not match',
    );
    expect(window.warehouseCheckout?.validation.revision).toBe('newer-revision');
    expect(execute).not.toHaveBeenCalled();
});
