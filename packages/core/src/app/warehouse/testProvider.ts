import { markTestPaymentAttempt } from './checkTest';
import { getWarehouseCheckout } from './config';
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

// Only authenticated validator responses populate this module-local state.
export function acceptTestProviderAuthorization(value: TestProviderAuthorization | undefined) {
    authorization = undefined;

    const config = getWarehouseCheckout();

    if (!value || !config) return;
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

export function testProviderAuthorization(): TestProviderAuthorization | undefined {
    const config = getWarehouseCheckout();
    const deployment = getWarehouseDeployment();

    if (
        deployment.mode !== 'staging' ||
        !deployment.stores.find((store) => store.checkoutOrigin === window.location.origin)
            ?.allowTestProvider ||
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
