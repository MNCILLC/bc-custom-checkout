import { getWarehouseCheckout, type WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';
import type { WarehousePaymentSelection } from './paymentAuthorization';

export interface TestProviderAuthorization {
    version: 1;
    methodId: 'bigpaypay';
    testMode: true;
    token: string;
    expiresAt: number;
}
export interface TestProviderClaim {
    token: string;
    methodId: string;
    gatewayId: string | null;
    usesStoredInstrument: false;
    shouldSaveInstrument: false;
}
export type TestProviderPayment = WarehousePaymentSelection;

let authorization:
    | { grant: TestProviderAuthorization; cartId: string; revision: string; credential: string }
    | undefined;

export type TestProviderIneligibility =
    | { code: 'MAX_LINE_ITEMS_EXCEEDED'; maxLineItems: number }
    | { code: 'MAX_QUANTITY_EXCEEDED'; maxQuantity: number }
    | { code: 'MAX_GRAND_TOTAL_EXCEEDED'; maxGrandTotal: number; currency: string };

const eligibilityChanged = 'warehouse-test-provider-eligibility';
let cartLimitBlock: { config: WarehouseCheckoutConfig; message: string } | undefined;

export function subscribeTestProviderEligibility(listener: () => void) {
    window.addEventListener(eligibilityChanged, listener);

    return () => window.removeEventListener(eligibilityChanged, listener);
}

export function getCartLimitMessage(): string | undefined {
    return cartLimitBlock && window.warehouseCheckout === cartLimitBlock.config
        ? cartLimitBlock.message
        : undefined;
}

function describeCartLimit(reason: TestProviderIneligibility): string {
    if (reason.code === 'MAX_GRAND_TOTAL_EXCEEDED') {
        const { currency, maxGrandTotal } = reason;

        if (
            !Number.isFinite(maxGrandTotal) ||
            maxGrandTotal <= 0 ||
            typeof currency !== 'string' ||
            !/^[A-Z]{3}$/.test(currency)
        )
            throw new Error('Invalid Test payment provider cart limit.');

        const cap = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
            maxGrandTotal,
        );

        return `The maximum order total is ${cap}. Return to your cart and reduce the total to continue.`;
    }

    const limit =
        reason.code === 'MAX_QUANTITY_EXCEEDED' ? reason.maxQuantity : reason.maxLineItems;

    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error('Invalid Test payment provider cart limit.');

    if (reason.code === 'MAX_QUANTITY_EXCEEDED') {
        return `Checkout allows up to ${limit} ${limit === 1 ? 'unit' : 'units'} per order. Return to your cart and reduce the total quantity to continue.`;
    }

    return reason.maxLineItems === 1
        ? 'Checkout allows one line item per order. Return to your cart and keep only one product or variant to continue.'
        : `Checkout allows up to ${reason.maxLineItems} line items per order. Return to your cart and reduce the number of line items to continue.`;
}

function testProviderOptedIn() {
    const deployment = getWarehouseDeployment();

    return (
        (deployment.mode === 'staging' || deployment.mode === 'development') &&
        deployment.stores.find((store) => store.checkoutOrigin === window.location.origin)
            ?.allowTestProvider
    );
}

// Only authenticated validator responses populate this module-local state.
export function acceptTestProviderAuthorization(
    value: TestProviderAuthorization | undefined,
    ineligibility?: TestProviderIneligibility,
) {
    authorization = undefined;

    const config = getWarehouseCheckout();

    cartLimitBlock = undefined;

    if (
        config &&
        (ineligibility?.code === 'MAX_LINE_ITEMS_EXCEEDED' ||
            ineligibility?.code === 'MAX_QUANTITY_EXCEEDED' ||
            ineligibility?.code === 'MAX_GRAND_TOTAL_EXCEEDED')
    ) {
        if (value) throw new Error('Invalid Test payment provider cart limit.');

        const message = describeCartLimit(ineligibility);

        if (testProviderOptedIn()) {
            cartLimitBlock = { config, message };
        }
    }

    if (value && config) {
        if (
            value.version !== 1 ||
            value.methodId !== 'bigpaypay' ||
            !value.testMode ||
            typeof value.token !== 'string' ||
            !value.token ||
            !Number.isSafeInteger(value.expiresAt) ||
            value.expiresAt <= Math.floor(Date.now() / 1000)
        )
            throw new Error('Invalid Test payment provider authorization.');
        authorization = {
            grant: value,
            cartId: config.cartId,
            revision: config.validation.revision,
            credential: config.validation.token,
        };
    }

    window.dispatchEvent(new Event(eligibilityChanged));
}

export function testProviderAuthorization(): TestProviderAuthorization | undefined {
    const config = getWarehouseCheckout();

    if (
        !testProviderOptedIn() ||
        !config ||
        !authorization ||
        authorization.cartId !== config.cartId ||
        authorization.revision !== config.validation.revision ||
        authorization.credential !== config.validation.token ||
        authorization.grant.expiresAt <= Math.floor(Date.now() / 1000)
    )
        return;

    return authorization.grant;
}

export function canSubmitTestProvider(): boolean {
    try {
        return !!testProviderAuthorization();
    } catch {
        return false;
    }
}

export function assertTestProviderPayment(payment: TestProviderPayment | undefined) {
    if (
        !payment ||
        payment.methodId !== 'bigpaypay' ||
        payment.selectedMethodId !== 'bigpaypay' ||
        payment.gatewayId ||
        payment.customSubmit ||
        payment.usesStoredInstrument !== false ||
        payment.shouldSaveInstrument !== false
    )
        throw new Error(
            'Only the native Test payment provider payment method is authorized for this test.',
        );
}
