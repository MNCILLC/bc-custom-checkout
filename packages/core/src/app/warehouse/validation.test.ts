import { type WarehouseCheckoutConfig } from './config';
import { validateCurrentWarehouse } from './validation';

const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'cart-a',
    validation: {
        endpoint: 'https://validator.example/validate',
        token: 'private-test-token',
        revision: 'revision-a',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'north',
        label: 'North',
        pickupLabel: 'Collect at North',
        locationId: 73,
        pickupMethodId: 94,
        allowShipping: true,
    },
};
const originalFetch = global.fetch;

beforeEach(() => {
    window.warehouseCheckout = JSON.parse(JSON.stringify(config)) as WarehouseCheckoutConfig;
});
afterEach(() => {
    delete window.warehouseCheckout;
    global.fetch = originalFetch;
});
it('sends a cart-bound capability without storefront cookies and uses server policy', async () => {
    const serverWarehouse = { ...config.warehouse, allowShipping: false };
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
            Promise.resolve({
                version: 1,
                cartId: 'cart-a',
                revision: 'revision-a',
                warehouse: serverWarehouse,
            }),
    });

    global.fetch = fetchMock;
    await validateCurrentWarehouse();
    expect(fetchMock).toHaveBeenCalledWith(
        config.validation.endpoint,
        expect.objectContaining({
            credentials: 'omit',
            headers: expect.objectContaining({ Authorization: 'Bearer private-test-token' }),
            body: JSON.stringify({ cartId: 'cart-a', revision: 'revision-a' }),
        }),
    );
    expect(window.warehouseCheckout?.warehouse.allowShipping).toBe(false);
});
it.each([401, 409, 503])('fails closed on status %s', async (status) => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ message: 'Return to cart' }),
    });
    await expect(validateCurrentWarehouse()).rejects.toThrow('Return to cart');
});
it('rejects a successful response for another cart or revision', async () => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
            Promise.resolve({
                version: 1,
                cartId: 'cart-b',
                revision: 'revision-a',
                warehouse: config.warehouse,
            }),
    });
    await expect(validateCurrentWarehouse()).rejects.toThrow('did not match');
});
it('reports unavailable validation instead of continuing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('network'));
    await expect(validateCurrentWarehouse()).rejects.toThrow('Cannot reach');
});
