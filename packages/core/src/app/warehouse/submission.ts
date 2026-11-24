import { type CheckoutService } from '@bigcommerce/checkout-sdk';

import { type CheckTestPayment } from './checkTest';
import { getWarehouseCheckout, warehouseConsignmentsValid } from './config';
import { assertFreightReady, freightFingerprint } from './freight';
import { assertNoSubmissionRecovery, RECOVERY_MESSAGE, submissionNeedsReview } from './recovery';
import { createSubmissionGuard } from './submissionGuard';
import { backgroundWarehouseChecks, setWarehouseSubmissionInProgress } from './submissionState';
import { assertTestPayment, beginTestPaymentAttempt, canSubmitTestPayment } from './testPayment';
import { getCartLimitMessage } from './testProvider';
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
    payment?: () => CheckTestPayment,
    retainTestProviderFields?: (cartId: string) => () => void,
): Promise<T | undefined> {
    const config = getWarehouseCheckout();

    if (!config) return (await prepare()) ? execute() : undefined;
    if (warehouseTransitionInProgress())
        throw new Error('Wait for your delivery choice to finish updating.');

    const fingerprint = () => {
        const data = service.getState().data;

        return JSON.stringify({
            snapshot: submissionSnapshot(service),
            freight: freightFingerprint(),
            checkoutVersion: data.getCheckout()?.version,
            billing: data.getBillingAddress(),
            consignments: data.getConsignments(),
            authorization: getWarehouseCheckout()?.validation,
            warehouseId: getWarehouseCheckout()?.warehouse.id,
            payment: payment?.(),
        });
    };

    return submit({
        prepare: async () => {
            assertNoSubmissionRecovery();
            if (canSubmitTestPayment()) assertTestPayment(payment?.());

            const check = backgroundWarehouseChecks.get(service);

            if (check) {
                const reviewed = fingerprint();

                await check;

                if (fingerprint() !== reviewed)
                    throw new Error('Checkout changed. Review your checkout before retrying.');
            }

            assertNoSubmissionRecovery();

            return prepare();
        },
        refresh: async () => {
            await service.loadCheckout(config.cartId);
        },
        fingerprint,
        validate: async () => {
            if (!warehouseConsignmentsValid(service.getState().data.getConsignments() || []))
                throw new Error('Select a delivery option for your warehouse before continuing.');

            await assertFreightReady(service);
            await validateCurrentWarehouse(undefined, submissionSnapshot(service));

            const cartLimitMessage = getCartLimitMessage();

            if (cartLimitMessage) throw new Error(cartLimitMessage);
            await assertFreightReady(service);
        },
        execute: async () => {
            let releaseFields: (() => void) | undefined;

            try {
                // Preview stays blocked unless this cart has an explicit test payment authorization.
                // Isolated tests use a simulated executor; they never submit an order.
                if (config.preview) {
                    if (!canSubmitTestPayment())
                        throw new Error(
                            'Warehouse verified. Preview only: no order was submitted.',
                        );

                    const reviewed = fingerprint();
                    const choice = payment?.();

                    assertTestPayment(choice);

                    const methods = service.getState().data.getPaymentMethods();

                    if (
                        !methods?.some(
                            (method) => method.id === choice?.methodId && !method.gateway,
                        )
                    )
                        throw new Error(
                            'This payment method is no longer available for this checkout. Choose another method.',
                        );

                    if (choice?.methodId === 'bigpaypay' && retainTestProviderFields) {
                        // Recording the attempt immediately makes recovery hide payment methods.
                        releaseFields = retainTestProviderFields(config.cartId);
                    }

                    const claim = beginTestPaymentAttempt(choice);

                    await validateCurrentWarehouse(undefined, submissionSnapshot(service), claim);
                    await assertFreightReady(service);
                    if (!canSubmitTestPayment() || fingerprint() !== reviewed)
                        throw new Error(RECOVERY_MESSAGE);
                    assertTestPayment(payment?.());
                }

                return await execute();
            } catch (error) {
                if (submissionNeedsReview()) throw new Error(RECOVERY_MESSAGE);
                throw error;
            } finally {
                releaseFields?.();
            }
        },
    });
}
