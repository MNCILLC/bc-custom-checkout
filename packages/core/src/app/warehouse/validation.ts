import {
    acceptCheckTestAuthorization,
    type CheckTestAuthorization,
    type CheckTestClaim,
} from './checkTest';
import { getWarehouseCheckout, validateWarehouseCheckout } from './config';
import { RECOVERY_MESSAGE, requireSubmissionReview } from './recovery';
import { type SubmissionSnapshot } from './submission';
import { warehouseSubmissionInProgress } from './submissionState';
import {
    acceptTestProviderAuthorization,
    type TestProviderAuthorization,
    type TestProviderClaim,
    type TestProviderIneligibility,
} from './testProvider';

export class RecoveryUnavailableError extends Error {
    constructor() {
        super(
            'We can’t verify your order status right now. Do not submit again. Contact the store for help.',
        );
    }
}

let transitions = 0;

export const warehouseTransitionInProgress = () => transitions > 0;

export function beginWarehouseTransition(): () => void {
    if (warehouseSubmissionInProgress())
        throw new Error('Wait for checkout verification to finish before changing delivery.');

    transitions += 1;

    return () => {
        transitions -= 1;
    };
}

export async function validateCurrentWarehouse(
    requestedMode?: 'pickup' | 'shipping',
    submission?: SubmissionSnapshot,
    checkTest?: CheckTestClaim,
    testProvider?: TestProviderClaim,
): Promise<void> {
    if (checkTest && testProvider) throw new Error('Choose one test authorization.');

    const current = getWarehouseCheckout();

    if (!current) return;

    // Hold the exact capability used for this request even if bootstrap data changes in place.
    const config = {
        ...current,
        validation: { ...current.validation },
        warehouse: { ...current.warehouse },
    };

    validateWarehouseCheckout(config, config.cartId);

    const endpoint = new URL(config.validation.endpoint);

    if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
        throw new Error('Warehouse validation requires a secure endpoint. Return to your cart.');
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(endpoint.href, {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            headers: {
                Authorization: `Bearer ${config.validation.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cartId: config.cartId,
                revision: config.validation.revision,
                ...(requestedMode ? { requestedMode } : {}),
                ...(submission ? { submission } : {}),
                ...(checkTest ? { checkTest } : {}),
                ...(testProvider ? { testProvider } : {}),
            }),
            signal: controller.signal,
        });
        const result = (await response.json()) as {
            recovery?: { status: string };
            code?: string;
            version: number;
            cartId: string;
            revision: string;
            warehouse: typeof config.warehouse;
            message?: string;
            submission?: SubmissionSnapshot;
            checkTestAuthorization?: CheckTestAuthorization;
            checkTestClaimed?: boolean;
            testProviderAuthorization?: TestProviderAuthorization;
            testProviderClaimed?: boolean;
            testProviderIneligibility?: TestProviderIneligibility;
        };

        if (
            response.status === 409 &&
            result.recovery?.status === 'review_required' &&
            result.code === 'SUBMISSION_REVIEW_REQUIRED' &&
            result.version === 1 &&
            result.cartId === config.cartId &&
            result.revision === config.validation.revision &&
            getWarehouseCheckout()?.cartId === config.cartId &&
            getWarehouseCheckout()?.validation.token === config.validation.token &&
            getWarehouseCheckout()?.validation.revision === config.validation.revision &&
            getWarehouseCheckout()?.validation.endpoint === config.validation.endpoint
        ) {
            requireSubmissionReview(config);
            acceptCheckTestAuthorization(undefined);
            acceptTestProviderAuthorization(undefined);
            throw new Error(RECOVERY_MESSAGE);
        }

        if (response.status === 503 && result.code === 'RECOVERY_UNAVAILABLE')
            throw new RecoveryUnavailableError();

        if (!response.ok)
            throw new Error(
                result.message || 'Warehouse verification failed. Return to your cart.',
            );
        if (
            (checkTest &&
                (result.checkTestClaimed !== true ||
                    result.checkTestAuthorization?.token !== checkTest.token)) ||
            (testProvider &&
                (result.testProviderClaimed !== true ||
                    result.testProviderAuthorization?.token !== testProvider.token)) ||
            result.version !== 1 ||
            result.cartId !== config.cartId ||
            result.revision !== config.validation.revision ||
            (submission && JSON.stringify(result.submission) !== JSON.stringify(submission)) ||
            getWarehouseCheckout()?.validation.revision !== config.validation.revision ||
            getWarehouseCheckout()?.validation.token !== config.validation.token ||
            getWarehouseCheckout()?.validation.endpoint !== config.validation.endpoint ||
            getWarehouseCheckout()?.cartId !== config.cartId
        )
            throw new Error(
                'Warehouse validation did not match this checkout. Return to your cart.',
            );

        const verified = { ...config, warehouse: result.warehouse };

        validateWarehouseCheckout(verified, config.cartId);
        // Fulfillment policy is supplied by the authenticated server response.
        window.warehouseCheckout = verified;
        acceptCheckTestAuthorization(result.checkTestAuthorization);
        acceptTestProviderAuthorization(
            result.testProviderAuthorization,
            result.testProviderIneligibility,
        );
    } catch (error) {
        if (checkTest || testProvider) {
            requireSubmissionReview(config);
            throw new Error(RECOVERY_MESSAGE);
        }

        if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError'))
            throw new Error(
                'Cannot reach warehouse verification. Check your connection and retry.',
            );
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}
