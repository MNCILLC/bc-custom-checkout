import { getWarehouseCheckout } from './config';

export type ShippingQuoteStatus = 'review' | 'loading' | 'failed' | 'ready';

let current: { key: string; status: ShippingQuoteStatus } | undefined;
const listeners = new Set<() => void>();
const key = () => {
    const config = getWarehouseCheckout();

    return `${config?.cartId}:${config?.validation.revision}`;
};

export function setShippingQuoteStatus(status: ShippingQuoteStatus) {
    current = { key: key(), status };
    listeners.forEach((listener) => listener());
}

export function getShippingQuoteStatus(): ShippingQuoteStatus {
    return current?.key === key() ? current.status : 'review';
}

export function subscribeShippingQuote(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
