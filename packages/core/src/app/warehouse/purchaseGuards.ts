import { setPaymentProviderGuard } from '@bigcommerce/checkout/payment-integration-api';

import { getWarehouseCheckout, validateWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import { paymentGrants } from './paymentAuthorization';
import { assertNoSubmissionRecovery, submissionNeedsReview } from './recovery';
import { canSubmitTestPayment } from './testPayment';

let purchaseGuardsInstalled = false;

export function installPurchaseGuards() {
    if (purchaseGuardsInstalled) return;
    purchaseGuardsInstalled = true;

    const removeProviderGuard = setPaymentProviderGuard((methodId, flow, gatewayId) => {
        if (getWarehouseDeployment().mode === 'off' && !window.warehouseCheckout) return;

        const config = getWarehouseCheckout();

        if (!config) throw new Error('Warehouse checkout is unavailable. Return to your cart.');
        validateWarehouseCheckout(config, config.cartId);
        assertNoSubmissionRecovery();

        if (flow === 'payment') {
            // The two native sandbox methods can render in preview-only checkout.
            if (gatewayId === undefined && (methodId === 'bigpaypay' || methodId === 'cheque')) {
                return;
            }

            // Gateway-bound grants are restricted to the configured local test card.
            if (
                gatewayId &&
                paymentGrants()?.some(
                    (grant) => grant.methodId === methodId && grant.gatewayId === gatewayId,
                )
            ) {
                return;
            }
        }

        throw new Error(
            'This payment provider is unavailable while warehouse purchasing is blocked.',
        );
    });

    const blocked = () => {
        try {
            return (
                (getWarehouseDeployment().mode !== 'off' || !!window.warehouseCheckout) &&
                (!canSubmitTestPayment() || submissionNeedsReview())
            );
        } catch {
            return true;
        }
    };

    // Only the standard form opts in: its onSubmit always runs warehouse validation
    // and the final preview block before any SDK or provider-specific executor.
    const isValidatedPaymentForm = (form: EventTarget | null): boolean => {
        if (!(form instanceof HTMLFormElement) || form.dataset.warehouseValidatedSubmit !== 'true')
            return false;

        const button = form.querySelector('#checkout-payment-continue');

        if (
            !(button instanceof HTMLButtonElement) ||
            button.type !== 'submit' ||
            button.form !== form
        )
            return false;

        try {
            const config = getWarehouseCheckout();

            if (!config) return false;
            validateWarehouseCheckout(config, config.cartId);
            if (submissionNeedsReview()) return false;

            return true;
        } catch {
            return false;
        }
    };

    const onSubmit = (event: Event) => {
        if (
            blocked() &&
            event.target instanceof Element &&
            event.target.querySelector('#checkout-payment-continue') &&
            !isValidatedPaymentForm(event.target)
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    const onClick = (event: Event) => {
        const button =
            event.target instanceof Element
                ? event.target.closest('#checkout-payment-continue')
                : null;

        if (
            blocked() &&
            button &&
            !(button instanceof HTMLButtonElement && isValidatedPaymentForm(button.form))
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };

    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick, true);

    return () => {
        removeProviderGuard();
        document.removeEventListener('submit', onSubmit, true);
        document.removeEventListener('click', onClick, true);
        purchaseGuardsInstalled = false;
    };
}
