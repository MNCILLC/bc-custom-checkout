import { getConsignment } from '../shipping/consignment.mock';

import {
    validateWarehouseCheckout,
    type WarehouseCheckoutConfig,
    warehouseConsignmentsValid,
    warehouseShippingOptions,
} from './config';

const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'test-cart',
    validation: {
        endpoint: 'https://validator.example/validate',
        token: 'test-token',
        revision: 'test-revision',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'north',
        label: 'North',
        pickupLabel: 'Collect at North',
        locationId: 73,
        pickupMethodId: 94,
        allowShipping: false,
    },
};

afterEach(() => {
    delete window.warehouseCheckout;
});
it('accepts a different store configuration and rejects a mismatched cart', () => {
    expect(() => validateWarehouseCheckout(config, 'test-cart')).not.toThrow();
    expect(() => validateWarehouseCheckout(config, 'another-cart')).toThrow();
});
it('requires the configured pickup method for pickup-only warehouses', () => {
    window.warehouseCheckout = config;
    expect(
        warehouseConsignmentsValid([
            { ...getConsignment(), selectedPickupOption: { pickupMethodId: 94 } },
        ]),
    ).toBe(true);
    expect(
        warehouseConsignmentsValid([
            { ...getConsignment(), selectedPickupOption: { pickupMethodId: 1 } },
        ]),
    ).toBe(false);
    expect(warehouseConsignmentsValid([getConsignment()])).toBe(false);
});
it('allows shipping only for enabled warehouses and excludes legacy pickup rates', () => {
    window.warehouseCheckout = {
        ...config,
        warehouse: { ...config.warehouse, allowShipping: true },
    };
    expect(warehouseConsignmentsValid([getConsignment()])).toBe(true);

    const option = getConsignment().selectedShippingOption;

    if (!option) throw new Error('Missing shipping test fixture');

    expect(
        warehouseShippingOptions([option, { ...option, type: 'shipping_pickupinstore' }]),
    ).toEqual([option]);
    expect(
        warehouseConsignmentsValid([
            {
                ...getConsignment(),
                selectedShippingOption: { ...option, type: 'shipping_pickupinstore' },
            },
        ]),
    ).toBe(false);
});
