import type { CheckoutService } from '@bigcommerce/checkout-sdk';

import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import { setShippingQuoteStatus } from './shippingQuoteState';

export interface FreightPreferences {
    fulfillmentMethod: 'ship' | 'pickup';
    accessorials: string[];
    version: number;
}
export interface FreightResponse {
    version: number;
    cartId: string;
    revision: string;
    preferences: FreightPreferences | null;
    services: Array<{ code: string; label: string; description: string }>;
}

let state: FreightResponse | undefined;
let approved: FreightResponse | undefined;

export function freightEndpoint(): string | undefined {
    return getWarehouseDeployment().stores.find(
        (entry) => entry.checkoutOrigin === window.location.origin,
    )?.freightEndpoint;
}

export function invalidateFreight() {
    approved = undefined;
    setShippingQuoteStatus('review');
}

export function freightApproved(pickup: boolean) {
    return (
        !!approved?.preferences &&
        approved.cartId === getWarehouseCheckout()?.cartId &&
        approved.revision === getWarehouseCheckout()?.validation.revision &&
        approved.preferences.fulfillmentMethod === (pickup ? 'pickup' : 'ship') &&
        JSON.stringify(approved.preferences) === JSON.stringify(state?.preferences)
    );
}

export function freightFingerprint() {
    return JSON.stringify(approved?.preferences);
}

async function request(update?: {
    selection: { fulfillmentMethod: 'ship' | 'pickup'; accessorials: string[] };
    expectedVersion: number;
}): Promise<FreightResponse> {
    const config = getWarehouseCheckout();
    const endpoint = freightEndpoint();

    if (
        !config ||
        !endpoint ||
        new URL(endpoint).origin !== new URL(config.validation.endpoint).origin
    )
        throw new Error('Delivery preferences are not configured for this checkout.');

    // Both attempts share one deadline. Only preference reads may recover;
    // never replay a preference write, submission claim, or order request.
    const options: RequestInit = {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
            Authorization: `Bearer ${config.validation.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            cartId: config.cartId,
            revision: config.validation.revision,
            ...(update ? { update } : {}),
        }),
        signal: AbortSignal.timeout(20000),
    };
    let response = await fetch(endpoint, options);

    if (!update && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 250));
        response = await fetch(endpoint, options);
    }

    const result = (await response.json()) as FreightResponse & { message?: string };

    if (!response.ok)
        throw new Error(
            result.message || 'Delivery preferences are unavailable. Reload preferences and retry.',
        );
    if (
        result.version !== 1 ||
        result.cartId !== config.cartId ||
        result.revision !== config.validation.revision ||
        !Array.isArray(result.services) ||
        result.services.some(
            (service) =>
                !service ||
                typeof service.code !== 'string' ||
                typeof service.label !== 'string' ||
                typeof service.description !== 'string',
        ) ||
        !Object.prototype.hasOwnProperty.call(result, 'preferences') ||
        (result.preferences &&
            (!Number.isSafeInteger(result.preferences.version) ||
                result.preferences.version < 1 ||
                !Array.isArray(result.preferences.accessorials) ||
                result.preferences.accessorials.some(
                    (code) =>
                        typeof code !== 'string' ||
                        !result.services.some((service) => service.code === code),
                ) ||
                !['ship', 'pickup'].includes(result.preferences.fulfillmentMethod))) ||
        getWarehouseCheckout()?.cartId !== config.cartId ||
        getWarehouseCheckout()?.validation.revision !== config.validation.revision
    )
        throw new Error('Delivery preferences do not match this checkout.');

    return result;
}

export async function loadFreightPreferences() {
    const result = await request();

    state = result;

    return result;
}

export async function saveFreightPreferences(pickup: boolean, codes?: string[]) {
    if (!freightEndpoint()) return;
    invalidateFreight();
    setShippingQuoteStatus('loading');

    const config = getWarehouseCheckout();

    if (!state || state.cartId !== config?.cartId || state.revision !== config.validation.revision)
        throw new Error('Load delivery preferences before changing fulfillment.');
    state = await request({
        selection: {
            fulfillmentMethod: pickup ? 'pickup' : 'ship',
            accessorials: pickup ? [] : (codes ?? state.preferences?.accessorials ?? []),
        },
        expectedVersion: state.preferences?.version ?? 0,
    });
}

export async function approveFreightPreferences() {
    if (!freightEndpoint()) return;

    const confirmed = await request();

    if (JSON.stringify(confirmed.preferences) !== JSON.stringify(state?.preferences))
        throw new Error('Delivery preferences changed. Reload preferences and review them.');
    approved = confirmed;
    setShippingQuoteStatus('ready');
}

export async function assertFreightReady(service: CheckoutService) {
    if (!freightEndpoint()) return;

    const reviewed = approved;

    if (!reviewed?.preferences)
        throw new Error('Confirm delivery options in the delivery step before continuing.');

    const current = await request();
    const consignments = service.getState().data.getConsignments() || [];
    const pickup = consignments.length === 1 && !!consignments[0].selectedPickupOption;

    if (
        approved !== reviewed ||
        current.cartId !== reviewed.cartId ||
        current.revision !== reviewed.revision ||
        JSON.stringify(current.preferences) !== JSON.stringify(reviewed.preferences) ||
        current.preferences?.fulfillmentMethod !== (pickup ? 'pickup' : 'ship')
    ) {
        invalidateFreight();
        throw new Error(
            'Delivery preferences changed. Return to the delivery step and refresh your quote.',
        );
    }
}
