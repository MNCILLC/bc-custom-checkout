import { type Consignment, type ShippingOption } from '@bigcommerce/checkout-sdk';

import { getWarehouseDeployment } from './deployment';

export interface WarehouseCheckoutConfig {
    version: 1;
    cartId: string;
    preview: true;
    validation: {
        endpoint: string;
        token: string;
        revision: string;
        expiresAt: number;
    };
    warehouse: {
        id: string;
        label: string;
        pickupLabel: string;
        locationId: number;
        pickupMethodId: number;
        allowShipping: boolean;
    };
}

declare global {
    interface Window {
        warehouseCheckout?: WarehouseCheckoutConfig;
    }
}

export function getWarehouseCheckout(): WarehouseCheckoutConfig | undefined {
    const config = typeof window === 'undefined' ? undefined : window.warehouseCheckout;

    if (getWarehouseDeployment().mode !== 'off') {
        if (!config) throw new Error('Warehouse checkout is unavailable. Return to your cart.');
        validateWarehouseCheckout(config, config.cartId);
    }

    return config;
}

export function validateWarehouseCheckout(value: WarehouseCheckoutConfig, cartId: string): void {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid warehouse checkout handoff. Return to your cart.');

    const warehouse = value.warehouse;

    if (
        value.version !== 1 ||
        value.cartId !== cartId ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- Runtime handoff data is untrusted despite its TypeScript annotation.
        value.preview !== true ||
        typeof value.cartId !== 'string' ||
        !value.cartId.trim() ||
        !value.validation?.endpoint ||
        typeof value.validation.token !== 'string' ||
        !value.validation.token.trim() ||
        typeof value.validation.revision !== 'string' ||
        !value.validation.revision.trim() ||
        !Number.isSafeInteger(value.validation.expiresAt) ||
        value.validation.expiresAt <= Math.floor(Date.now() / 1000) ||
        typeof warehouse?.id !== 'string' ||
        !warehouse.id.trim() ||
        typeof warehouse.label !== 'string' ||
        !warehouse.label.trim() ||
        typeof warehouse.pickupLabel !== 'string' ||
        !warehouse.pickupLabel.trim() ||
        !Number.isSafeInteger(warehouse.locationId) ||
        warehouse.locationId <= 0 ||
        !Number.isSafeInteger(warehouse.pickupMethodId) ||
        warehouse.pickupMethodId <= 0 ||
        typeof warehouse.allowShipping !== 'boolean'
    ) {
        throw new Error('Invalid warehouse checkout handoff. Return to your storefront cart.');
    }

    const endpoint = new URL(value.validation.endpoint);

    if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (endpoint.protocol !== 'https:' &&
            !(
                endpoint.protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(endpoint.hostname)
            ))
    )
        throw new Error('Invalid warehouse validation endpoint. Return to your cart.');

    const deployment = getWarehouseDeployment();

    if (deployment.mode !== 'off') {
        const store = deployment.stores.find(
            (entry) => entry.checkoutOrigin === window.location.origin,
        );

        if (!store || endpoint.href !== store.validationEndpoint)
            throw new Error(
                'Warehouse checkout is not configured for this store. Return to your cart.',
            );
    }
}

export function warehouseConsignmentsValid(consignments: Consignment[]): boolean {
    const config = getWarehouseCheckout();

    if (!config) return true;
    if (consignments.length !== 1) return false;

    const consignment = consignments[0];

    return consignment.selectedPickupOption
        ? consignment.selectedPickupOption.pickupMethodId === config.warehouse.pickupMethodId
        : config.warehouse.allowShipping &&
              !!consignment.selectedShippingOption &&
              consignment.selectedShippingOption.type !== 'shipping_pickupinstore';
}

export function warehouseShippingOptions(options?: ShippingOption[]): ShippingOption[] | undefined {
    return getWarehouseCheckout()
        ? options?.filter((option) => option.type !== 'shipping_pickupinstore')
        : options;
}
