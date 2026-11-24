import { type CheckoutService } from '@bigcommerce/checkout-sdk';
import { act, renderHook } from '@testing-library/react';

import { getPaymentMethod } from '../payment/payment-methods.mock';
import useTestProviderFields from '../payment/useTestProviderFields';

import { acceptCheckTestAuthorization } from './checkTest';
import type { WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';
import { submissionNeedsReview } from './recovery';
import { submitWithWarehouseValidation } from './submission';
import { beginTestPaymentAttempt } from './testPayment';
import { acceptTestProviderAuthorization, canSubmitTestProvider } from './testProvider';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));

const deployment = getWarehouseDeployment as jest.Mock;
const originalFetch = global.fetch;
let number = 0;
let config: WarehouseCheckoutConfig;
let service: CheckoutService;
let choice: {
    methodId: string;
    selectedMethodId: string;
    gatewayId?: string;
    customSubmit: boolean;
    usesStoredInstrument: boolean;
    shouldSaveInstrument: boolean;
};
const checkGrant = () => ({
    version: 1 as const,
    methodId: 'cheque' as const,
    token: 'signed-local-check',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
});
let offerCheck = false;
let granted = true;
let claimed = false;
let claimCalls = 0;
let duringClaim: (() => void) | undefined;
let duringValidation: (() => void) | undefined;
let uncertain = false;
let execute: jest.Mock;
const grant = () => ({
    version: 1 as const,
    methodId: 'bigpaypay' as const,
    testMode: true as const,
    token: 'signed-test-capability',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
});

beforeEach(() => {
    config = {
        version: 1,
        preview: true,
        cartId: `synthetic-${++number}`,
        validation: {
            endpoint: 'https://validator.example/validate',
            token: 'synthetic',
            revision: 'revision',
            expiresAt: 9999999999,
        },
        warehouse: {
            id: 'north',
            label: 'North',
            pickupLabel: 'North pickup',
            locationId: 11,
            pickupMethodId: 12,
            allowShipping: false,
        },
    };
    window.warehouseCheckout = config;
    deployment.mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: config.validation.endpoint,
                allowTestProvider: true,
            },
        ],
    });
    service = {
        getState: () => ({
            data: {
                getCheckout: () => ({ id: config.cartId, grandTotal: 50, version: 1 }),
                getCart: () => ({
                    lineItems: {
                        physicalItems: [{ id: 'item', productId: 1, variantId: 2, quantity: 1 }],
                    },
                }),
                getConsignments: () => [
                    {
                        id: 'c',
                        lineItemIds: ['item'],
                        selectedPickupOption: { pickupMethodId: 12 },
                    },
                ],
                getPaymentMethods: () => [{ id: 'bigpaypay' }, { id: 'cheque' }],
                getBillingAddress: () => ({ countryCode: 'US' }),
            },
        }),
        loadCheckout: jest.fn().mockResolvedValue(undefined),
    } as unknown as CheckoutService;
    choice = {
        methodId: 'bigpaypay',
        selectedMethodId: 'bigpaypay',
        customSubmit: false,
        usesStoredInstrument: false,
        shouldSaveInstrument: false,
    };
    offerCheck = false;
    granted = true;
    claimed = false;
    claimCalls = 0;
    duringClaim = duringValidation = undefined;
    uncertain = false;
    execute = jest.fn().mockResolvedValue('simulated-order');
    acceptTestProviderAuthorization(grant());
    global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options?.body as string);

        if (body.testProvider || body.checkTest) {
            claimCalls++;
            if (claimed)
                return {
                    ok: false,
                    json: async () => ({ message: 'already attempted' }),
                } as Response;
            claimed = true;
            if (duringClaim) duringClaim();
            if (uncertain) throw new TypeError('lost response');
        } else if (duringValidation) duringValidation();

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: config.cartId,
                revision: config.validation.revision,
                warehouse: config.warehouse,
                submission: body.submission,
                ...(granted ? { testProviderAuthorization: grant() } : {}),
                ...(offerCheck ? { checkTestAuthorization: checkGrant() } : {}),
                ...(body.checkTest ? { checkTestClaimed: true } : {}),
                ...(body.testProvider ? { testProviderClaimed: true } : {}),
            }),
        } as Response;
    });
});
afterEach(() => {
    global.fetch = originalFetch;
    delete window.warehouseCheckout;
});

const submit = () =>
    submitWithWarehouseValidation(
        service,
        async () => true,
        execute,
        () => ({ ...choice }),
    );

it.each([
    {
        reason: { code: 'MAX_LINE_ITEMS_EXCEEDED', maxLineItems: 1 },
        message: 'one line item per order',
    },
    {
        reason: { code: 'MAX_GRAND_TOTAL_EXCEEDED', maxGrandTotal: 948.38, currency: 'USD' },
        message: 'maximum order total is $948.38',
    },
    {
        reason: { code: 'MAX_QUANTITY_EXCEEDED', maxQuantity: 5 },
        message: 'up to 5 units per order',
    },
])(
    'blocks form submission before claiming when revalidation returns $reason.code',
    async ({ reason, message }) => {
        jest.mocked(global.fetch).mockImplementationOnce(async (_url, options) => {
            const body = JSON.parse(options?.body as string);

            expect(body.testProvider).toBeUndefined();

            return {
                ok: true,
                json: async () => ({
                    version: 1,
                    cartId: config.cartId,
                    revision: config.validation.revision,
                    warehouse: config.warehouse,
                    submission: body.submission,
                    testProviderIneligibility: reason,
                }),
            } as Response;
        });

        await expect(submit()).rejects.toThrow(message);
        expect(canSubmitTestProvider()).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(claimCalls).toBe(0);
        expect(execute).not.toHaveBeenCalled();
    },
);

it.each([
    { maxGrandTotal: NaN, currency: 'USD' },
    { maxGrandTotal: -1, currency: 'USD' },
    { maxGrandTotal: 948.38, currency: 'invalid' },
])('rejects malformed monetary limits and clears the prior grant', (invalid) => {
    acceptTestProviderAuthorization(grant());
    expect(() =>
        acceptTestProviderAuthorization(undefined, {
            code: 'MAX_GRAND_TOTAL_EXCEEDED',
            ...invalid,
        }),
    ).toThrow('Invalid Test payment provider cart limit');
    expect(canSubmitTestProvider()).toBe(false);
});

it.each(['cheque', 'bigpaypay'])(
    'uses the selected local method for the only claim: %s',
    async (methodId) => {
        deployment.mockReturnValue({
            mode: 'development',
            stores: [
                {
                    checkoutOrigin: window.location.origin,
                    validationEndpoint: config.validation.endpoint,
                    allowTestProvider: true,
                    allowCheckTest: true,
                },
            ],
        });
        offerCheck = true;
        acceptCheckTestAuthorization(checkGrant());
        choice.methodId = choice.selectedMethodId = methodId;

        await expect(submit()).resolves.toBe('simulated-order');
        expect(claimCalls).toBe(1);
        expect(execute).toHaveBeenCalledTimes(1);

        const calls = jest
            .mocked(global.fetch)
            .mock.calls.map(([, options]) => JSON.parse(options?.body as string));
        const submitted = calls.find((body) => body.checkTest || body.testProvider);

        expect(methodId === 'cheque' ? submitted.checkTest : submitted.testProvider).toMatchObject({
            methodId,
            gatewayId: null,
            token: methodId === 'cheque' ? checkGrant().token : grant().token,
        });
        expect(
            methodId === 'cheque' ? submitted.testProvider : submitted.checkTest,
        ).toBeUndefined();
        await expect(submit()).rejects.toThrow('Do not submit again');
        expect(claimCalls).toBe(1);
    },
);

it('shows recovery before checking a different payment method after a lost reply', async () => {
    uncertain = true;
    await expect(submit()).rejects.toThrow('Do not submit again');

    choice.methodId = choice.selectedMethodId = 'cheque';
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(claimCalls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
});

it('requires the selected method to still be offered by the SDK before claiming', async () => {
    const data = service.getState().data;

    service.getState = jest
        .fn()
        .mockReturnValue({ data: { ...data, getPaymentMethods: () => [{ id: 'cheque' }] } });

    await expect(submit()).rejects.toThrow('no longer available');
    expect(claimCalls).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(submissionNeedsReview()).toBe(false);
});

it('default build remains preview-only even with a server grant', async () => {
    deployment.mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: config.validation.endpoint,
            },
        ],
    });
    expect(canSubmitTestProvider()).toBe(false);
    await expect(submit()).rejects.toThrow('Preview only');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it.each(['complete', 'reject'])(
    'retains the submitting form until the SDK settles: %s',
    async (outcome) => {
        const method = { ...getPaymentMethod(), id: 'bigpaypay', gateway: undefined };
        const useFields = ({ cartId }: { cartId: string }) => {
            const methods = submissionNeedsReview() ? [] : [method];

            return useTestProviderFields(cartId, methods, methods[0]);
        };
        const initialProps = { cartId: config.cartId };
        const { result, rerender } = renderHook(useFields, { initialProps });
        const retain = jest.fn((cartId: string) =>
            result.current.retainTestProviderFields(cartId, method),
        );
        const run = () =>
            submitWithWarehouseValidation(
                service,
                async () => true,
                execute,
                () => choice,
                retain,
            );

        let start!: () => void;
        let finish!: () => void;
        const started = new Promise<void>((resolve) => {
            start = resolve;
        });
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });

        execute.mockImplementation(async () => {
            start();
            await pending;
            if (outcome === 'reject') throw new Error('simulated payment failure');
        });

        let attempt!: Promise<unknown>;

        await act(async () => {
            attempt = run();
            await started;
        });
        expect(submissionNeedsReview()).toBe(true);
        expect(result.current.methods).toEqual([method]);
        expect(result.current.defaultMethod).toBe(method);
        expect(renderHook(useFields, { initialProps }).result.current.methods).toEqual([]);
        rerender({ cartId: 'another-cart' });
        expect(result.current.methods).toEqual([]);
        rerender(initialProps);
        await expect(run()).rejects.toThrow('already in progress');
        expect(result.current.defaultMethod).toBe(method);

        await act(async () => {
            finish();
            if (outcome === 'reject') await expect(attempt).rejects.toThrow('Do not submit again');
            else await expect(attempt).resolves.toBeUndefined();
        });
        expect(result.current.methods).toEqual([]);
        await expect(run()).rejects.toThrow('Do not submit again');
        expect(retain).toHaveBeenCalledTimes(1);
        expect(claimCalls).toBe(1);
        expect(execute).toHaveBeenCalledTimes(1);
    },
);

it.each(['development', 'staging'])(
    'an explicit grant admits only one simulated native Test payment provider execution in %s',
    async (mode) => {
        deployment.mockReturnValue({ ...getWarehouseDeployment(), mode });
        await expect(submit()).resolves.toBe('simulated-order');
        expect(claimCalls).toBe(1);
        expect(execute).toHaveBeenCalledTimes(1);
        await expect(submit()).rejects.toThrow('Do not submit again');
        expect(execute).toHaveBeenCalledTimes(1);
    },
);
it.each(['card', 'gateway', 'custom', 'override'])('rejects %s before execution', async (kind) => {
    if (kind === 'card') choice.selectedMethodId = 'cheque';
    if (kind === 'gateway') choice.gatewayId = 'gateway';
    if (kind === 'custom') choice.customSubmit = true;
    if (kind === 'override') choice.methodId = 'cheque';
    await expect(submit()).rejects.toThrow('Only the native Test payment provider');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it('revocation at submit-time validation stays blocked', async () => {
    granted = false;
    await expect(submit()).rejects.toThrow('Preview only');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it('expired or changed-cart authorization cannot unblock the DOM gate', () => {
    config.cartId = 'different';
    expect(canSubmitTestProvider()).toBe(false);
    expect(() => acceptTestProviderAuthorization({ ...grant(), expiresAt: 1 })).toThrow();
    expect(canSubmitTestProvider()).toBe(false);
});
it('method change during validation stops before claim', async () => {
    duringValidation = () => {
        choice.methodId = 'cheque';
    };

    await expect(submit()).rejects.toThrow('Checkout changed');
    expect(claimCalls).toBe(0);
    expect(execute).not.toHaveBeenCalled();
});
it('method change during the claim stops execution and consumes the attempt', async () => {
    duringClaim = () => {
        choice.methodId = 'cheque';
    };

    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).not.toHaveBeenCalled();
    choice.methodId = 'bigpaypay';
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(claimCalls).toBe(1);
});
it('uncertain claim response blocks automatic retry', async () => {
    uncertain = true;

    const release = jest.fn();

    await expect(
        submitWithWarehouseValidation(
            service,
            async () => true,
            execute,
            () => choice,
            () => release,
        ),
    ).rejects.toThrow('Do not submit again');
    expect(release).toHaveBeenCalledTimes(1);
    uncertain = false;
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(claimCalls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
});
it('SDK failure after a successful claim cannot submit again', async () => {
    execute.mockRejectedValue(new Error('uncertain SDK response'));
    await expect(submit()).rejects.toThrow('Do not submit again');
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).toHaveBeenCalledTimes(1);
});
it('missing claim acknowledgement never executes', async () => {
    global.fetch = jest.fn(async (_url, options) => {
        const b = JSON.parse(options?.body as string);

        return {
            ok: true,
            json: async () => ({
                version: 1,
                cartId: config.cartId,
                revision: config.validation.revision,
                warehouse: config.warehouse,
                submission: b.submission,
                testProviderAuthorization: grant(),
            }),
        } as Response;
    });
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).not.toHaveBeenCalled();
});

it.each([
    'bigcommerce_payments',
    'bigcommerce_payments_creditcards',
    'stripe',
    'testgateway',
    'paypalcommerce',
    'cheque',
])('rejects other method %s', async (methodId) => {
    choice.methodId = choice.selectedMethodId = methodId;
    await expect(submit()).rejects.toThrow('Only the native Test payment provider');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it.each(['usesStoredInstrument', 'shouldSaveInstrument'] as const)('rejects %s', async (key) => {
    choice[key] = true;
    await expect(submit()).rejects.toThrow('Only the native Test payment provider');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it('rejects an authorization lacking explicit test mode and clears prior authorization', () => {
    expect(() =>
        acceptTestProviderAuthorization({ ...grant(), testMode: false } as never),
    ).toThrow();
    expect(canSubmitTestProvider()).toBe(false);
});
it('stale revision cannot use an old grant', async () => {
    config.validation.revision = 'changed';
    expect(canSubmitTestProvider()).toBe(false);
    granted = false;
    await expect(submit()).rejects.toThrow('Preview only');
    expect(execute).not.toHaveBeenCalled();
});
it('concurrent clicks execute at most one simulated payment', async () => {
    const results = await Promise.allSettled([submit(), submit()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(claimCalls).toBe(1);
});
it('grant/claim transport contains no card fields', async () => {
    await submit();

    const requests = (global.fetch as jest.Mock).mock.calls.map(([, options]) =>
        JSON.parse(options.body),
    );
    const claim = requests.find((body) => body.testProvider).testProvider;

    expect(Object.keys(claim).sort()).toEqual([
        'gatewayId',
        'methodId',
        'shouldSaveInstrument',
        'token',
        'usesStoredInstrument',
    ]);
});

it('an attempted provider cart cannot switch to a new Check attempt', async () => {
    await submit();
    acceptTestProviderAuthorization(undefined);
    deployment.mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: config.validation.endpoint,
                allowCheckTest: true,
            },
        ],
    });
    acceptCheckTestAuthorization({
        version: 1,
        methodId: 'cheque',
        token: 'different-grant',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    expect(() =>
        beginTestPaymentAttempt({
            methodId: 'cheque',
            selectedMethodId: 'cheque',
            customSubmit: false,
        }),
    ).toThrow('Do not submit again');
    acceptCheckTestAuthorization(undefined);
});

it('keeps recovery locked when the payment executor catches its own SDK failure', async () => {
    const onSubmitError = jest.fn();

    execute.mockImplementation(async () => {
        try {
            throw new Error('simulated SDK decline');
        } catch (error) {
            onSubmitError(error);
        }
    });
    await expect(submit()).resolves.toBeUndefined();
    expect(onSubmitError).toHaveBeenCalledTimes(1);
    expect(submissionNeedsReview()).toBe(true);
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(claimCalls).toBe(1);
});
