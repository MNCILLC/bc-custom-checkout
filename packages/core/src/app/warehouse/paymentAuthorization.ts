import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';

export const warehousePaymentMediaType = 'application/vnd.warehouse.payment.v1+json';

export interface WarehousePaymentSelection {
    methodId?: string;
    gatewayId?: string;
    selectedMethodId?: string;
    customSubmit: boolean;
    usesStoredInstrument?: boolean;
    shouldSaveInstrument?: boolean;
}

export interface PaymentGrant {
    version: 1;
    methodId: string;
    gatewayId: string | null;
    token: string;
    expiresAt: number;
    testMode?: boolean;
}

export interface PaymentClaim {
    token: string;
    methodId: string;
    gatewayId: string | null;
    usesStoredInstrument: false;
    shouldSaveInstrument: false;
}

let accepted:
    | {
          cartId: string;
          revision: string;
          credential: string;
          endpoint: string;
          grants: PaymentGrant[];
      }
    | undefined;

export function acceptPaymentGrants(grants: PaymentGrant[] | undefined) {
    accepted = undefined;

    const config = getWarehouseCheckout();

    if (grants === undefined || !config) return;
    if (
        !Array.isArray(grants) ||
        grants.some(
            (grant) =>
                !grant ||
                grant.version !== 1 ||
                !grant.methodId ||
                typeof grant.methodId !== 'string' ||
                (grant.gatewayId !== null && typeof grant.gatewayId !== 'string') ||
                typeof grant.token !== 'string' ||
                !grant.token ||
                !Number.isSafeInteger(grant.expiresAt),
        )
    )
        throw new Error('Invalid warehouse payment authorization.');

    accepted = {
        cartId: config.cartId,
        revision: config.validation.revision,
        credential: config.validation.token,
        endpoint: config.validation.endpoint,
        grants,
    };
}

// Undefined denotes an older validator. An empty offer from the new validator is authoritative.
export function paymentGrants(): PaymentGrant[] | undefined {
    if (!accepted) return undefined;

    const config = getWarehouseCheckout();

    if (
        !config ||
        accepted.cartId !== config.cartId ||
        accepted.revision !== config.validation.revision ||
        accepted.credential !== config.validation.token ||
        accepted.endpoint !== config.validation.endpoint
    )
        return undefined;

    const deployment = getWarehouseDeployment();
    const store = deployment.stores.find(
        (entry) =>
            entry.checkoutOrigin === window.location.origin &&
            entry.validationEndpoint === config.validation.endpoint,
    );

    if (
        !store ||
        deployment.mode === 'off' ||
        (deployment.mode === 'staging' &&
            store.allowCheckTest &&
            store.allowTestProvider &&
            !store.allowHostedSandboxCheck)
    )
        return [];

    return accepted.grants.filter(
        (grant) =>
            grant.gatewayId === null &&
            grant.expiresAt > Math.floor(Date.now() / 1000) &&
            ((grant.methodId === 'bigpaypay' &&
                grant.testMode === true &&
                store.allowTestProvider) ||
                (grant.methodId === 'cheque' && store.allowCheckTest)),
    );
}

export function selectedPaymentGrant(
    grants: PaymentGrant[],
    payment?: WarehousePaymentSelection,
): PaymentGrant {
    const grant = grants.find(
        (grant) =>
            grant.methodId === payment?.methodId &&
            grant.gatewayId === (payment?.gatewayId ?? null),
    );

    if (
        !grant ||
        !payment ||
        payment.selectedMethodId !== grant.methodId ||
        payment.customSubmit ||
        payment.usesStoredInstrument !== false ||
        payment.shouldSaveInstrument !== false
    )
        throw new Error(
            'The selected payment method is unavailable for this checkout. Choose another method.',
        );

    return grant;
}
