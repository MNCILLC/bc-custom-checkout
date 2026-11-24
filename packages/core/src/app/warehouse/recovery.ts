import { getWarehouseCheckout, type WarehouseCheckoutConfig } from './config';

export const RECOVERY_MESSAGE =
    'An order attempt has been recorded, but its outcome needs review. Do not submit again. Contact the store to confirm your order status.';
export const RECOVERY_EVENT = 'warehouse-submission-recovery';

const attempted = new Set<string>();

function recoveryKey(config = getWarehouseCheckout()) {
    return config
        ? `warehouse-submission-recovery:v1:${config.validation.endpoint}:${config.cartId}`
        : undefined;
}

// UX hint only. The backend permanent claim is authoritative across browsers/instances.
// No credentials, payment details, outcome assumptions, expiry or reset are stored here.
export function submissionNeedsReview(): boolean {
    const key = recoveryKey();

    if (!key) return false;
    if (attempted.has(key)) return true;

    try {
        return window.localStorage.getItem(key) !== null;
    } catch {
        return false;
    }
}

export function requireSubmissionReview(config?: WarehouseCheckoutConfig) {
    const key = recoveryKey(config);

    if (!key) return;
    attempted.add(key);

    try {
        window.localStorage.setItem(key, 'attempted');
    } catch {
        // Same-tab fallback; server claim still protects other contexts.
    }

    window.dispatchEvent(new Event(RECOVERY_EVENT));
}

// The server arbitrates other tabs. Also prevent repeat claims from this checkout
// if browser storage is unavailable or a response disappears in transit.
export function markSubmissionAttempt(config: WarehouseCheckoutConfig) {
    const key = recoveryKey(config);

    if (!key || attempted.has(key)) throw new Error(RECOVERY_MESSAGE);
    requireSubmissionReview(config);
}

export function assertNoSubmissionRecovery() {
    if (submissionNeedsReview()) throw new Error(RECOVERY_MESSAGE);
}
