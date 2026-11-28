import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';

export const warehousePaymentMediaType = 'application/vnd.warehouse.payment.v1+json';

const grantsChanged = 'warehouse-payment-grants';

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

    if (grants === undefined || !config) {
        window.dispatchEvent(new Event(grantsChanged));

        return;
    }

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
    window.dispatchEvent(new Event(grantsChanged));
}

export function subscribePaymentGrants(listener: () => void) {
    let timer: number | undefined;

    // A grant can expire even if the next background validation has not returned yet.
    const update = () => {
        window.clearTimeout(timer);

        const now = Date.now();
        const nextExpiry = accepted?.grants.reduce((next, grant) => {
            const expiry = grant.expiresAt * 1000;

            return expiry > now ? Math.min(next, expiry) : next;
        }, Infinity);

        if (nextExpiry !== undefined && Number.isFinite(nextExpiry)) {
            timer = window.setTimeout(update, Math.min(nextExpiry - now, 2_147_483_647));
        }

        listener();
    };

    window.addEventListener(grantsChanged, update);
    update();

    return () => {
        window.removeEventListener(grantsChanged, update);
        window.clearTimeout(timer);
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

    return accepted.grants.filter((grant) => {
        if (grant.expiresAt <= Math.floor(Date.now() / 1000)) return false;

        if (grant.gatewayId !== null) {
            const preview = store.localCardPreview;

            return (
                deployment.mode === 'development' &&
                store.allowTestProvider === true &&
                grant.testMode === true &&
                preview?.methodId === grant.methodId &&
                preview.gatewayId === grant.gatewayId
            );
        }

        return (
            (grant.methodId === 'bigpaypay' &&
                grant.testMode === true &&
                store.allowTestProvider) ||
            (grant.methodId === 'cheque' && store.allowCheckTest)
        );
    });
}

function findGrant(grants: PaymentGrant[], methodId?: string, gatewayId?: string) {
    return grants.find(
        (grant) => grant.methodId === methodId && grant.gatewayId === (gatewayId ?? null),
    );
}

export function paymentMethodWarning(methodId?: string, gatewayId?: string) {
    if (!methodId || !accepted) return;

    try {
        const grants = paymentGrants();

        if (!grants || findGrant(grants, methodId, gatewayId)) return;
        if (grants.length) return 'payment.errors.payment_method_no_longer_available';

        // A loader with both purchase opt-ins off still supports preview validation.
        const { stores } = getWarehouseDeployment();
        const store = stores.find((entry) => entry.checkoutOrigin === window.location.origin);

        if (store?.allowCheckTest || store?.allowTestProvider)
            return 'payment.no_available_payment_methods_text';
    } catch {
        // The warehouse gate handles invalid or expired handoffs. Keep the action disabled.
        return 'payment.payment_methods_unavailable_error';
    }
}

export function selectedPaymentGrant(
    grants: PaymentGrant[],
    payment?: WarehousePaymentSelection,
): PaymentGrant {
    const grant = findGrant(grants, payment?.methodId, payment?.gatewayId);

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
