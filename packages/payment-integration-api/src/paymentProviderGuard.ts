export type PaymentProviderFlow = 'payment' | 'express';
export type PaymentProviderGuard = (
    methodId: string | undefined,
    flow: PaymentProviderFlow,
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
): void {
    guard?.(methodId, flow);
}

export function isPaymentProviderAllowed(
    methodId: string | undefined,
    flow: PaymentProviderFlow,
): boolean {
    try {
        assertPaymentProviderAllowed(methodId, flow);

        return true;
    } catch {
        return false;
    }
}
