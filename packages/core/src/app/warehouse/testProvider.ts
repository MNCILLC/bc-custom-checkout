import { markTestPaymentAttempt } from './checkTest';
import { getWarehouseCheckout, type WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';

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
export interface TestProviderPayment {
    methodId?: string;
    gatewayId?: string;
    selectedMethodId?: string;
    customSubmit: boolean;
    usesStoredInstrument?: boolean;
    shouldSaveInstrument?: boolean;
}

let authorization:
    | { grant: TestProviderAuthorization; cartId: string; revision: string; credential: string }
    | undefined;

export interface TestProviderIneligibility {
    code: string;
    maxLineItems?: number;
}

const eligibilityChanged = 'warehouse-test-provider-eligibility';
let lineItemBlock: { config: WarehouseCheckoutConfig; message: string } | undefined;

export function subscribeTestProviderEligibility(listener: () => void) {
    window.addEventListener(eligibilityChanged, listener);

    return () => window.removeEventListener(eligibilityChanged, listener);
}

export function getLineItemLimitMessage(): string | undefined {
    return lineItemBlock && window.warehouseCheckout === lineItemBlock.config
        ? lineItemBlock.message
        : undefined;
}

function testProviderOptedIn() {
    const deployment = getWarehouseDeployment();

    return (
        deployment.mode === 'staging' &&
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

    lineItemBlock = undefined;

    if (config && ineligibility?.code === 'MAX_LINE_ITEMS_EXCEEDED') {
        const limit = ineligibility.maxLineItems;

        if (value || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)
            throw new Error('Invalid Test payment provider line-item limit.');

        if (testProviderOptedIn()) {
            lineItemBlock = {
                config,
                message:
                    limit === 1
                        ? 'Checkout allows one line item per order. Return to your cart and keep only one product or variant to continue.'
                        : `Checkout allows up to ${limit} line items per order. Return to your cart and reduce the number of line items to continue.`,
            };
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

export function beginTestProviderAttempt(
    payment: TestProviderPayment | undefined,
): TestProviderClaim {
    assertTestProviderPayment(payment);

    const grant = testProviderAuthorization();
    const config = getWarehouseCheckout();

    if (!grant || !config) throw new Error('Test payment provider authorization is unavailable.');

    // No reset on errors, reload responses, or SDK failure. Server tombstone also covers other tabs.
    markTestPaymentAttempt(config.cartId);

    return {
        token: grant.token,
        methodId: 'bigpaypay',
        gatewayId: null,
        usesStoredInstrument: false,
        shouldSaveInstrument: false,
    };
}
