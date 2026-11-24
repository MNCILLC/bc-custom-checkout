import { getWarehouseDeployment } from './deployment';
import { RECOVERY_MESSAGE, requireSubmissionReview, submissionNeedsReview } from './recovery';
import { validateCurrentWarehouse } from './validation';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));

let config: any;
let sequence = 0;
const originalFetch = global.fetch;

beforeEach(() => {
    window.localStorage.clear();
    config = {
        version: 1,
        preview: true,
        cartId: `recovery-${++sequence}`,
        validation: {
            endpoint: 'https://validator.example/validate',
            token: 'synthetic',
            revision: 'r',
            expiresAt: 9999999999,
        },
        warehouse: {
            id: 'west',
            label: 'West',
            pickupLabel: 'West pickup',
            locationId: 1,
            pickupMethodId: 1,
            allowShipping: false,
        },
    };
    window.warehouseCheckout = config;
    (getWarehouseDeployment as jest.Mock).mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: config.validation.endpoint,
            },
        ],
    });
});
afterEach(() => {
    global.fetch = originalFetch;
    delete window.warehouseCheckout;
    window.localStorage.clear();
    jest.restoreAllMocks();
});

const response = (changes = {}) => ({
    version: 1,
    cartId: config.cartId,
    revision: 'r',
    code: 'SUBMISSION_REVIEW_REQUIRED',
    recovery: { status: 'review_required' },
    ...changes,
});

it('persists a credential-free cart-scoped hint through fresh module contexts and never clears it on ordinary verification', async () => {
    requireSubmissionReview();
    expect(submissionNeedsReview()).toBe(true);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(window.localStorage.key(0) ?? 'missing-key')).toBe(
        'attempted',
    );
    jest.isolateModules(() => expect(require('./recovery').submissionNeedsReview()).toBe(true));
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            version: 1,
            cartId: config.cartId,
            revision: 'r',
            warehouse: config.warehouse,
        }),
    });
    await validateCurrentWarehouse();
    expect(submissionNeedsReview()).toBe(true);
    window.warehouseCheckout = { ...config, cartId: 'different-cart' };
    expect(submissionNeedsReview()).toBe(false);
});
it('keeps the same-tab lock when browser storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
    });
    requireSubmissionReview();
    expect(submissionNeedsReview()).toBe(true);
});
it('accepts authenticated recovery without requiring an active cart/warehouse payload', async () => {
    global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 409, json: async () => response() });
    await expect(validateCurrentWarehouse()).rejects.toThrow(RECOVERY_MESSAGE);
    expect(submissionNeedsReview()).toBe(true);
});
it.each([{ cartId: 'other' }, { revision: 'old' }, { version: 2 }])(
    'does not persist recovery from a mismatched response: %p',
    async (changes) => {
        global.fetch = jest
            .fn()
            .mockResolvedValue({ ok: false, status: 409, json: async () => response(changes) });
        await expect(validateCurrentWarehouse()).rejects.toThrow();
        expect(submissionNeedsReview()).toBe(false);
    },
);
it('does not apply a late response after the cart capability changes', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
        const body = response();

        config.validation.token = 'new-capability';

        return { ok: false, status: 409, json: async () => body };
    });
    await expect(validateCurrentWarehouse()).rejects.toThrow();
    expect(submissionNeedsReview()).toBe(false);
});
it('pre-claim network failures preserve verification retries; post-claim loss requires review', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('lost response'));
    await expect(validateCurrentWarehouse()).rejects.toThrow('Check your connection and retry');
    expect(submissionNeedsReview()).toBe(false);
    await expect(
        validateCurrentWarehouse(undefined, undefined, {
            testProvider: {
                token: 'synthetic',
                methodId: 'bigpaypay',
                gatewayId: null,
                usesStoredInstrument: false,
                shouldSaveInstrument: false,
            },
        }),
    ).rejects.toThrow(RECOVERY_MESSAGE);
    expect(submissionNeedsReview()).toBe(true);
});

it('records a lost claim response against the original cart rather than a newly bootstrapped cart', async () => {
    const original = config;

    global.fetch = jest.fn().mockImplementation(async () => {
        window.warehouseCheckout = { ...config, cartId: 'replacement-cart' };
        throw new TypeError('lost response');
    });
    await expect(
        validateCurrentWarehouse(undefined, undefined, {
            testProvider: {
                token: 'synthetic',
                methodId: 'bigpaypay',
                gatewayId: null,
                usesStoredInstrument: false,
                shouldSaveInstrument: false,
            },
        }),
    ).rejects.toThrow(RECOVERY_MESSAGE);
    expect(submissionNeedsReview()).toBe(false);
    window.warehouseCheckout = original;
    expect(submissionNeedsReview()).toBe(true);
});
