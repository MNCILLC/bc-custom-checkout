import { getWarehouseDeployment } from './deployment';

export function localStorefrontUrl(path: string, fallback: string): string {
    const deployment = getWarehouseDeployment();

    if (deployment.mode !== 'development' || typeof window === 'undefined') return fallback;

    const endpoint = deployment.stores.find(
        (store) => store.checkoutOrigin === window.location.origin,
    )?.initializationEndpoint;

    return endpoint ? new URL(path, endpoint).href : fallback;
}

export function showLocalCheckoutNotice(container: Element): void {
    if (
        getWarehouseDeployment().mode !== 'development' ||
        document.getElementById('warehouse-local-notice')
    )
        return;

    const notice = document.createElement('div');
    const link = document.createElement('a');

    notice.id = 'warehouse-local-notice';
    notice.style.cssText =
        'padding:12px 24px;background:#fff4cc;color:#302500;font:14px sans-serif';
    notice.textContent = 'Local development: order submission disabled. ';
    link.href = localStorefrontUrl('/cart/', '');
    link.textContent = 'Return to local cart';
    notice.appendChild(link);
    container.before(notice);
}
