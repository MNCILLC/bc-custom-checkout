import type { CheckoutService } from '@bigcommerce/checkout-sdk';

import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import {
    approveFreightPreferences,
    assertFreightReady,
    freightApproved,
    hasRestoredPickupReview,
    invalidateFreight,
    loadFreightPreferences,
    rememberPickupReview,
    restorePickupReview,
    saveFreightPreferences,
} from './freight';

jest.mock('./config', () => ({ getWarehouseCheckout: jest.fn() }));
jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));

const originalFetch = global.fetch;
let config: any;
let preferences: any;
const service = {
    getState: () => ({
        data: { getConsignments: () => [{ selectedShippingOption: { id: 'rate' } }] },
    }),
} as unknown as CheckoutService;

beforeEach(() => {
    sessionStorage.clear();
    invalidateFreight();
    config = {
        cartId: 'synthetic-cart',
        validation: {
            endpoint: 'https://backend.invalid/validate',
            revision: 'revision-a',
            token: 'synthetic-token',
        },
    };
    (getWarehouseCheckout as jest.Mock).mockImplementation(() => config);
    (getWarehouseDeployment as jest.Mock).mockReturnValue({
        stores: [
            {
                checkoutOrigin: window.location.origin,
                freightEndpoint: 'https://backend.invalid/freight',
            },
        ],
    });
    preferences = null;
    global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options?.body as string);

        if (body.update)
            preferences = {
                ...body.update.selection,
                version: Number(body.update.expectedVersion) + 1,
            };

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: config.cartId,
                revision: config.validation.revision,
                preferences,
                services: [{ code: 'HYD', label: 'Liftgate', description: 'Description' }],
            }),
        } as Response;
    });
});
afterEach(() => {
    global.fetch = originalFetch;
});

async function ready() {
    await loadFreightPreferences();
    await saveFreightPreferences(false, ['HYD']);
    await approveFreightPreferences();
}

it('sends only cart capability to configured backend and confirms shipping', async () => {
    await ready();
    expect(freightApproved(false)).toBe(true);
    await expect(assertFreightReady(service)).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
        'https://backend.invalid/freight',
        expect.objectContaining({
            credentials: 'omit',
            headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
        }),
    );
    expect(
        JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).update.expectedVersion,
    ).toBe(0);
});
it('blocks dirty or unconfirmed options', async () => {
    await ready();
    invalidateFreight();
    await expect(assertFreightReady(service)).rejects.toThrow('Confirm delivery');
});
it('rejects another tab changing preferences at submit time', async () => {
    await ready();
    preferences = { ...preferences, accessorials: [], version: 2 };
    await expect(assertFreightReady(service)).rejects.toThrow('changed');
    expect(freightApproved(false)).toBe(false);
});
it('rejects native pickup when confirmed preferences are shipping', async () => {
    await ready();

    const pickupService = {
        getState: () => ({
            data: { getConsignments: () => [{ selectedPickupOption: { pickupMethodId: 1 } }] },
        }),
    } as unknown as CheckoutService;

    await expect(assertFreightReady(pickupService)).rejects.toThrow('changed');
});
it('clears accessorials when saving pickup', async () => {
    await ready();
    await saveFreightPreferences(true, ['HYD']);
    await approveFreightPreferences();
    expect(preferences.accessorials).toEqual([]);
    expect(freightApproved(true)).toBe(true);
});
it('does not silently reload and overwrite after a conflict', async () => {
    await ready();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Stale preferences' }),
    });
    await expect(saveFreightPreferences(false, [])).rejects.toThrow('Stale');
    expect(freightApproved(false)).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(4);
});
it('blocks approval after an upstream outage', async () => {
    await ready();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await expect(assertFreightReady(service)).rejects.toThrow('network');
});
it.each([502, 503, 504])('recovers one temporary %s during a submit-time read', async (status) => {
    await ready();

    const cancel = jest.fn().mockResolvedValue(undefined);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status,
        body: { cancel },
        json: async () => {
            throw new Error('Gateway HTML is not JSON');
        },
    });
    await expect(assertFreightReady(service)).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(5);

    const attempts = (global.fetch as jest.Mock).mock.calls.slice(3);

    expect(attempts.map(([, options]) => JSON.parse(options.body))).toEqual([
        { cartId: config.cartId, revision: config.validation.revision },
        { cartId: config.cartId, revision: config.validation.revision },
    ]);
    expect(attempts[0][1].signal).toBe(attempts[1][1].signal);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(freightApproved(false)).toBe(true);
});
it('stops after one recovery read when the outage persists', async () => {
    await ready();
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Delivery preferences unavailable' }),
    });
    await expect(assertFreightReady(service)).rejects.toThrow('unavailable');
    expect(global.fetch).toHaveBeenCalledTimes(5);
});
it('never retries a preference write after a 503', async () => {
    await ready();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Delivery preferences unavailable' }),
    });
    await expect(saveFreightPreferences(false, [])).rejects.toThrow('unavailable');
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(freightApproved(false)).toBe(false);
});
it.each([400, 401, 403, 409])('does not retry a %s validation rejection', async (status) => {
    await ready();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status,
        json: async () => ({ message: 'Rejected' }),
    });
    await expect(assertFreightReady(service)).rejects.toThrow('Rejected');
    expect(global.fetch).toHaveBeenCalledTimes(4);
});
it('still blocks preferences changed while recovering a read', async () => {
    await ready();
    (global.fetch as jest.Mock).mockImplementationOnce(async () => {
        preferences = { ...preferences, version: 2, accessorials: [] };

        return { ok: false, status: 503 };
    });
    await expect(assertFreightReady(service)).rejects.toThrow('changed');
    expect(freightApproved(false)).toBe(false);
});
it('still blocks a warehouse switch while recovering a read', async () => {
    await ready();
    (global.fetch as jest.Mock).mockImplementationOnce(async () => {
        config = { ...config, validation: { ...config.validation, revision: 'revision-b' } };

        return { ok: false, status: 503 };
    });
    await expect(assertFreightReady(service)).rejects.toThrow('do not match');
});
it('never sends a capability to a different backend origin', async () => {
    (getWarehouseDeployment as jest.Mock).mockReturnValue({
        stores: [
            {
                checkoutOrigin: window.location.origin,
                freightEndpoint: 'https://other.invalid/freight',
            },
        ],
    });
    await expect(loadFreightPreferences()).rejects.toThrow('not configured');
    expect(global.fetch).not.toHaveBeenCalled();
});
it('rejects malformed successful responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
            version: 1,
            cartId: config.cartId,
            revision: config.validation.revision,
            services: [],
        }),
    });
    await expect(loadFreightPreferences()).rejects.toThrow('do not match');
});
it('requires loading the current cart before writes', async () => {
    await ready();
    config = { ...config, cartId: 'another-cart' };
    await expect(saveFreightPreferences(false, [])).rejects.toThrow('Load delivery');
});
it('remains optional for other stores', async () => {
    (getWarehouseDeployment as jest.Mock).mockReturnValue({ stores: [] });
    await expect(saveFreightPreferences(false, [])).resolves.toBeUndefined();
    await expect(assertFreightReady(service)).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
});

it('restores pickup only for the reviewed consignment and current server preference version', async () => {
    await ready();
    await saveFreightPreferences(true);
    await approveFreightPreferences();
    rememberPickupReview('consignment-a');
    invalidateFreight();
    await restorePickupReview();
    expect(hasRestoredPickupReview('consignment-a')).toBe(true);
    expect(hasRestoredPickupReview('consignment-b')).toBe(false);
    invalidateFreight();
    preferences = { ...preferences, version: Number(preferences.version) + 1 };
    await restorePickupReview();
    expect(hasRestoredPickupReview('consignment-a')).toBe(false);
});
