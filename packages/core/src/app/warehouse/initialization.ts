import { validateWarehouseCheckout, type WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';
import { fetchLocalCatalyst, LocalCheckoutConnectionError } from './local-catalyst';

export class WarehouseInventoryConflict extends Error {}

let cancelPending: (() => void) | undefined;

export function cancelWarehouseInitialization(): void {
    cancelPending?.();
}

export function warehouseInitializationEndpoint(): string | undefined {
    try {
        return getWarehouseDeployment().stores.find(
            (store) => store.checkoutOrigin === window.location.origin,
        )?.initializationEndpoint;
    } catch {
        return undefined;
    }
}

// Called only from a user click, so a normal browser can open a first-party
// storefront session without third-party cookies or redirect URL credentials.
export function requestWarehouseInitialization(cartId: string): Promise<WarehouseCheckoutConfig> {
    cancelWarehouseInitialization();

    const endpoint = warehouseInitializationEndpoint();

    if (!endpoint) return Promise.reject(new Error('Warehouse authorization is unavailable.'));

    const url = new URL(endpoint);
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    const requestId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    url.searchParams.set('cartId', cartId);
    url.searchParams.set('checkoutOrigin', window.location.origin);
    url.searchParams.set('requestId', requestId);

    return new Promise((resolve, reject) => {
        let popup: Window | null = null;
        let deadline: number | undefined;
        let closedCheck: number | undefined;
        const cleanup = () => {
            window.removeEventListener('message', receive);
            window.clearTimeout(deadline);
            window.clearInterval(closedCheck);
            if (cancelPending === cancel) cancelPending = undefined;
            popup?.close();
        };
        const fail = () => {
            cleanup();
            reject(
                new Error(
                    'Warehouse authorization failed. Return to your storefront cart and retry.',
                ),
            );
        };
        const cancel = () => fail();
        const receive = (event: MessageEvent) => {
            if (!popup || event.source !== popup || event.origin !== url.origin) return;

            const data = event.data as {
                error?: string;
                message?: unknown;
                protocol?: string;
                requestId?: string;
                cartId?: string;
                warehouseCheckout?: WarehouseCheckoutConfig;
            } | null;

            if (
                !data ||
                data.protocol !== 'warehouse-initialization-v1' ||
                data.requestId !== requestId
            )
                return;

            if (
                data.cartId === cartId &&
                data.error === 'INVENTORY_CONFLICT' &&
                !data.warehouseCheckout &&
                typeof data.message === 'string' &&
                data.message.trim()
            ) {
                cleanup();
                reject(new WarehouseInventoryConflict(data.message));

                return;
            }

            try {
                if (data.error || data.cartId !== cartId || !data.warehouseCheckout)
                    throw new Error('Invalid response');
                validateWarehouseCheckout(data.warehouseCheckout, cartId);
                cleanup();
                resolve(data.warehouseCheckout);
            } catch {
                fail();
            }
        };

        cancelPending = cancel;
        window.addEventListener('message', receive);

        try {
            popup = window.open(url.href, '_blank', 'popup,width=540,height=640');

            if (!popup) {
                fail();

                return;
            }

            deadline = window.setTimeout(fail, 60000);
            closedCheck = window.setInterval(() => {
                if (popup?.closed) fail();
            }, 1000);
        } catch {
            fail();
        }
    });
}

let automaticRequest:
    | { cartId: string; fragment: string; result: Promise<WarehouseCheckoutConfig> }
    | undefined;

async function exchangeHandoff(
    cartId: string,
    handoffId: string,
    container: Element,
): Promise<WarehouseCheckoutConfig> {
    const deployment = getWarehouseDeployment();
    const store = deployment.stores.find(
        (entry) => entry.checkoutOrigin === window.location.origin,
    );

    if (
        !store?.currentCustomerClientId ||
        !store.handoffEndpoint ||
        !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(handoffId)
    )
        throw new Error('Return to your cart and open Checkout again.');

    const loopback =
        deployment.mode === 'development' &&
        new URL(store.handoffEndpoint).hostname === 'localhost';
    const request = loopback ? fetchLocalCatalyst : fetch;

    if (loopback) {
        const notice = container.querySelector(
            '[data-test="warehouse-initialization"][role="status"]',
        );

        if (notice) {
            notice.textContent =
                'Connecting to local Catalyst. If your browser asks, allow this site to access apps on this device.';
        }

        // Resolve device permission before requesting the shopper's short-lived identity.
        const ready = await request(store.handoffEndpoint, {
            method: 'OPTIONS',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
        });

        if (!ready.ok) throw new LocalCheckoutConnectionError();
    }

    const identityUrl = new URL('/customer/current.jwt', window.location.origin);

    identityUrl.searchParams.set('app_client_id', store.currentCustomerClientId);

    const identity = await fetch(identityUrl.href, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
    });

    if (!identity.ok) throw new Error('Sign in and reopen Checkout from your cart.');

    const token = (await identity.text()).trim();

    if (!token || token.length > 8192) throw new Error('Shopper identity is unavailable.');

    const response = await request(store.handoffEndpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cartId, handoffId }),
    });

    if (!response.ok) {
        if (response.status === 409) {
            const problem = (await response.json().catch(() => null)) as {
                code?: string;
                message?: string;
            } | null;

            if (problem?.code === 'INVENTORY_CONFLICT' && typeof problem.message === 'string')
                throw new WarehouseInventoryConflict(problem.message);
        }

        throw new Error('Return to your cart and open Checkout again.');
    }

    const config = (await response.json()) as WarehouseCheckoutConfig;

    validateWarehouseCheckout(config, cartId);

    return config;
}

export function initializeWarehouseCheckout(
    container: Element,
    cartId: string,
    isCurrent: () => boolean,
    fromRetryClick = false,
): Promise<void> {
    const fragment = window.location.hash;
    const params = new URLSearchParams(fragment.slice(1));

    if (params.has('warehouseHandoff')) {
        if (
            !automaticRequest ||
            automaticRequest.cartId !== cartId ||
            automaticRequest.fragment !== fragment
        ) {
            const result = exchangeHandoff(cartId, params.get('warehouseHandoff') ?? '', container);

            automaticRequest = { cartId, fragment, result };

            const clear = () => {
                if (automaticRequest?.result === result) automaticRequest = undefined;
            };

            void result.then(clear, clear);
        }

        return automaticRequest.result.then((config) => {
            if (!isCurrent() || window.location.hash !== fragment)
                throw new Error('Authorization was superseded.');
            window.warehouseCheckout = config;
            params.delete('warehouseHandoff');

            const url = new URL(window.location.href);

            url.hash = params.toString();
            window.history.replaceState(window.history.state, '', url.href);
        });
    }

    if (window.warehouseCheckout !== undefined) {
        validateWarehouseCheckout(window.warehouseCheckout, cartId);

        return Promise.resolve();
    }

    if (!warehouseInitializationEndpoint())
        throw new Error('Warehouse authorization is unavailable.');

    const authorize = async () => {
        const config = await requestWarehouseInitialization(cartId);

        if (!isCurrent()) throw new Error('Authorization was superseded.');
        window.warehouseCheckout = config;
    };

    if (fromRetryClick) return authorize();

    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = 'Continue securely';
    container.appendChild(button);

    return new Promise((resolve, reject) => {
        button.onclick = () => {
            if (!isCurrent()) return;
            button.disabled = true;
            void authorize().then(resolve, reject);
        };
    });
}
