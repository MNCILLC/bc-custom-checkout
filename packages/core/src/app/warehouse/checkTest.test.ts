import { type CheckoutService } from '@bigcommerce/checkout-sdk';

import { acceptCheckTestAuthorization, canSubmitCheckTest } from './checkTest';
import type { WarehouseCheckoutConfig } from './config';
import { getWarehouseDeployment } from './deployment';
import { submitWithWarehouseValidation } from './submission';

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
};
let granted = true;
let claimed = false;
let claimCalls = 0;
let duringClaim: (() => void) | undefined;
let duringValidation: (() => void) | undefined;
let uncertain = false;
let execute: jest.Mock;
const grant = () => ({
    version: 1 as const,
    methodId: 'cheque' as const,
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
                allowCheckTest: true,
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
    choice = { methodId: 'cheque', selectedMethodId: 'cheque', customSubmit: false };
    granted = true;
    claimed = false;
    claimCalls = 0;
    duringClaim = duringValidation = undefined;
    uncertain = false;
    execute = jest.fn().mockResolvedValue('simulated-order');
    acceptCheckTestAuthorization(grant());
    global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options?.body as string);

        if (body.checkTest) {
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
                ...(granted ? { checkTestAuthorization: grant() } : {}),
                ...(body.checkTest ? { checkTestClaimed: true } : {}),
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
    expect(canSubmitCheckTest()).toBe(false);
    await expect(submit()).rejects.toThrow('Preview only');
    expect(execute).not.toHaveBeenCalled();
    expect(claimCalls).toBe(0);
});
it('an explicit grant admits only one simulated native Check execution', async () => {
    await expect(submit()).resolves.toBe('simulated-order');
    expect(claimCalls).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).toHaveBeenCalledTimes(1);
});
it.each(['card', 'gateway', 'custom', 'override'])('rejects %s before execution', async (kind) => {
    if (kind === 'card') choice.selectedMethodId = 'bigpaypay';
    if (kind === 'gateway') choice.gatewayId = 'gateway';
    if (kind === 'custom') choice.customSubmit = true;
    if (kind === 'override') choice.methodId = 'bigpaypay';
    await expect(submit()).rejects.toThrow('Only the native Check');
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
    expect(canSubmitCheckTest()).toBe(false);
    expect(() => acceptCheckTestAuthorization({ ...grant(), expiresAt: 1 })).toThrow();
    expect(canSubmitCheckTest()).toBe(false);
});
it('method change during validation stops before claim', async () => {
    duringValidation = () => {
        choice.methodId = 'bigpaypay';
    };

    await expect(submit()).rejects.toThrow('Checkout changed');
    expect(claimCalls).toBe(0);
    expect(execute).not.toHaveBeenCalled();
});
it('method change during the claim stops execution and consumes the attempt', async () => {
    duringClaim = () => {
        choice.methodId = 'bigpaypay';
    };

    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).not.toHaveBeenCalled();
    choice.methodId = 'cheque';
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(claimCalls).toBe(1);
});
it('uncertain claim response blocks automatic retry', async () => {
    uncertain = true;
    await expect(submit()).rejects.toThrow('Do not submit again');
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
                checkTestAuthorization: grant(),
            }),
        } as Response;
    });
    await expect(submit()).rejects.toThrow('Do not submit again');
    expect(execute).not.toHaveBeenCalled();
});
