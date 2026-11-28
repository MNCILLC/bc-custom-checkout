export type PaymentProviderFlow = 'payment' | 'express';
export type PaymentProviderGuard = (
    methodId: string | undefined,
    flow: PaymentProviderFlow,
    gatewayId?: string,
) => void;

let guard: PaymentProviderGuard | undefined;

// Installed by the checkout bootstrap, before any provider component can mount.
// Integrations depend only on this shared contract, never on storefront/warehouse code.
export function setPaymentProviderGuard(next: PaymentProviderGuard): () => void {
    const previous = guard;

    guard = next;

    return () => {
        if (guard === next) guard = previous;
    };
}

export function assertPaymentProviderAllowed(
    methodId: string | undefined,
    flow: PaymentProviderFlow,
    gatewayId?: string,
): void {
    guard?.(methodId, flow, gatewayId);
}

export function isPaymentProviderAllowed(
    methodId: string | undefined,
    flow: PaymentProviderFlow,
    gatewayId?: string,
): boolean {
    try {
        assertPaymentProviderAllowed(methodId, flow, gatewayId);

        return true;
    } catch {
        return false;
    }
}
