export class LocalCheckoutConnectionError extends Error {
    constructor() {
        super(
            'Checkout could not reach local Catalyst. Check that Catalyst is running and allow this site to access apps on this device, then reopen Checkout from your cart.',
        );
    }
}

// A browser awaiting loopback permission can hold a fetch indefinitely.
export async function fetchLocalCatalyst(endpoint: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
        return await fetch(endpoint, { ...init, signal: controller.signal });
    } catch {
        throw new LocalCheckoutConnectionError();
    } finally {
        window.clearTimeout(timeout);
    }
}
