import { getWarehouseCheckout, validateWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import { submissionNeedsReview } from './recovery';
import { canSubmitTestPayment } from './testPayment';

let purchaseGuardsInstalled = false;

export function installPurchaseGuards() {
    if (purchaseGuardsInstalled) return;
    purchaseGuardsInstalled = true;

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
        document.removeEventListener('submit', onSubmit, true);
        document.removeEventListener('click', onClick, true);
        purchaseGuardsInstalled = false;
    };
}
