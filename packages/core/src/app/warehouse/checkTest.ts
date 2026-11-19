import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';

export interface CheckTestAuthorization {
    version: 1;
    methodId: 'cheque';
    token: string;
    expiresAt: number;
}
export interface CheckTestClaim {
    token: string;
    methodId: string;
    gatewayId: string | null;
}
export interface CheckTestPayment {
    methodId?: string;
    gatewayId?: string;
    selectedMethodId?: string;
    customSubmit: boolean;
}

let authorization:
    | { grant: CheckTestAuthorization; cartId: string; revision: string; credential: string }
    | undefined;
const attemptedCarts = new Set<string>();

// Only authenticated validator responses populate this module-local state.
export function acceptCheckTestAuthorization(value: CheckTestAuthorization | undefined) {
    authorization = undefined;

    const config = getWarehouseCheckout();

    if (!value || !config) return;
    if (
        value.version !== 1 ||
        value.methodId !== 'cheque' ||
        typeof value.token !== 'string' ||
        !value.token ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= Math.floor(Date.now() / 1000)
    )
        throw new Error('Invalid Check test authorization.');
    authorization = {
        grant: value,
        cartId: config.cartId,
        revision: config.validation.revision,
        credential: config.validation.token,
    };
}

export function checkTestAuthorization(): CheckTestAuthorization | undefined {
    const config = getWarehouseCheckout();
    const deployment = getWarehouseDeployment();

    if (
        deployment.mode !== 'staging' ||
        !deployment.stores.find((store) => store.checkoutOrigin === window.location.origin)
            ?.allowCheckTest ||
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

export function canSubmitCheckTest(): boolean {
    try {
        return !!checkTestAuthorization();
    } catch {
        return false;
    }
}

export function assertCheckTestPayment(payment: CheckTestPayment | undefined) {
    if (
        !payment ||
        payment.methodId !== 'cheque' ||
        payment.selectedMethodId !== 'cheque' ||
        payment.gatewayId ||
        payment.customSubmit
    )
        throw new Error('Only the native Check payment method is authorized for this test.');
}

export function beginCheckTestAttempt(payment: CheckTestPayment | undefined): CheckTestClaim {
    assertCheckTestPayment(payment);

    const grant = checkTestAuthorization();
    const config = getWarehouseCheckout();

    if (!grant || !config) throw new Error('Check test authorization is unavailable.');
    if (attemptedCarts.has(config.cartId))
        throw new Error('Reconcile this test cart before another submission attempt.');
    // No reset on errors, reload responses, or SDK failure. Server tombstone also covers other tabs.
    attemptedCarts.add(config.cartId);

    return { token: grant.token, methodId: 'cheque', gatewayId: null };
}
