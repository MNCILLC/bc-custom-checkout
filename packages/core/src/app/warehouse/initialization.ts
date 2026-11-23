import { validateWarehouseCheckout, type WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';

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

export function initializeWarehouseCheckout(
    container: Element,
    cartId: string,
    isCurrent: () => boolean,
    fromRetryClick = false,
): Promise<void> {
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
