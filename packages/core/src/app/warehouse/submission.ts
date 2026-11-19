import { type CheckoutService } from '@bigcommerce/checkout-sdk';

import { getWarehouseCheckout, warehouseConsignmentsValid } from './config';
import { assertFreightReady, freightFingerprint } from './freight';
import { createSubmissionGuard } from './submissionGuard';
import { setWarehouseSubmissionInProgress } from './submissionState';
import { validateCurrentWarehouse, warehouseTransitionInProgress } from './validation';

export interface SubmissionSnapshot {
    grandTotal: number;
    items: Array<{ id: string; productId: number; variantId: number; quantity: number }>;
    consignments: Array<{
        id: string;
        lineItemIds: string[];
        pickupMethodId: number | null;
        shippingOptionId: string | null;
    }>;
}

export function submissionSnapshot(service: CheckoutService): SubmissionSnapshot {
    const data = service.getState().data;
    const checkout = data.getCheckout();
    const cart = data.getCart();

    if (!checkout || !cart || checkout.id !== getWarehouseCheckout()?.cartId)
        throw new Error('Checkout is unavailable. Return to your cart.');

    return {
        grandTotal: checkout.grandTotal,
        items: cart.lineItems.physicalItems
            .map(({ id, productId, variantId, quantity }) => ({
                id: String(id),
                productId,
                variantId,
                quantity,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        consignments: (data.getConsignments() || [])
            .map((consignment) => ({
                id: consignment.id,
                lineItemIds: [...consignment.lineItemIds].sort(),
                pickupMethodId: consignment.selectedPickupOption?.pickupMethodId ?? null,
                shippingOptionId: consignment.selectedShippingOption?.id ?? null,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
    };
}

const submit = createSubmissionGuard(setWarehouseSubmissionInProgress);

export async function submitWithWarehouseValidation<T>(
    service: CheckoutService,
    prepare: () => Promise<boolean>,
    execute: () => Promise<T>,
): Promise<T | undefined> {
    const config = getWarehouseCheckout();

    if (!config) return (await prepare()) ? execute() : undefined;
    if (warehouseTransitionInProgress())
        throw new Error('Wait for your delivery choice to finish updating.');

    return submit({
        prepare,
        refresh: async () => {
            await service.loadCheckout(config.cartId);
        },
        fingerprint: () => {
            const data = service.getState().data;

            return JSON.stringify({
                snapshot: submissionSnapshot(service),
                freight: freightFingerprint(),
                checkoutVersion: data.getCheckout()?.version,
                billing: data.getBillingAddress(),
                consignments: data.getConsignments(),
                authorization: getWarehouseCheckout()?.validation,
                warehouseId: getWarehouseCheckout()?.warehouse.id,
            });
        },
        validate: async () => {
            if (!warehouseConsignmentsValid(service.getState().data.getConsignments() || []))
                throw new Error('Select a delivery option for your warehouse before continuing.');

            await assertFreightReady(service);
            await validateCurrentWarehouse(undefined, submissionSnapshot(service));
            await assertFreightReady(service);
        },
        execute: async () => {
            // This milestone stays non-purchasable, even if the DOM guard is bypassed.
            // Tests exercise createSubmissionGuard with an in-memory executor instead.
            if (config.preview)
                throw new Error('Warehouse verified. Preview only: no order was submitted.');

            return execute();
        },
    });
}
