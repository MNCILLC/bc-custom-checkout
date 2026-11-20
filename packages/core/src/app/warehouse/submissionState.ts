import type { CheckoutService } from '@bigcommerce/checkout-sdk/essential';

// Includes the SDK refresh so submit cannot overtake a change to the reviewed checkout.
export const backgroundWarehouseChecks = new WeakMap<CheckoutService, Promise<void>>();

let busy = false;

export const warehouseSubmissionInProgress = () => busy;

export function setWarehouseSubmissionInProgress(value: boolean) {
    busy = value;
    window.dispatchEvent(new Event('warehouse-submission-state'));
}
