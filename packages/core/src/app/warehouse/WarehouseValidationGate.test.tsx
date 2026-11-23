import type { CheckoutService } from '@bigcommerce/checkout-sdk/essential';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { getWarehouseDeployment } from './deployment';
import { submitWithWarehouseValidation } from './submission';
import { acceptTestProviderAuthorization, beginTestProviderAttempt } from './testProvider';
import Gate from './WarehouseValidationGate';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));
afterEach(() => {
    cleanup();
    delete window.warehouseCheckout;
});

function setupPickupCart(cartId: string, allowTestProvider = false) {
    const config = {
        version: 1 as const,
        preview: true as const,
        cartId,
        validation: {
            endpoint: 'https://validator.example/validate',
            token: 'synthetic',
            revision: 'r1',
            expiresAt: 9999999999,
        },
        warehouse: {
            id: 'powell',
            label: 'Powell',
            pickupLabel: 'Powell pickup',
            locationId: 1,
            pickupMethodId: 2,
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
                allowTestProvider,
            },
        ],
    });

    const checkout = { id: config.cartId, grandTotal: 50 };
    const loadCheckout = jest.fn().mockResolvedValue(undefined);
    const service = {
        subscribe: () => () => {},
        loadCheckout,
        getState: () => ({
            data: {
                getCheckout: () => checkout,
                getCart: () => ({
                    lineItems: {
                        physicalItems: [{ id: 'i', productId: 5, variantId: 6, quantity: 1 }],
                    },
                }),
                getConsignments: () => [
                    {
                        id: 'c',
                        lineItemIds: ['i'],
                        selectedPickupOption: { pickupMethodId: 2 },
                    },
                ],
                getBillingAddress: () => ({ countryCode: 'US' }),
            },
        }),
    } as unknown as CheckoutService;

    return { config, checkout, loadCheckout, service };
}

it('keeps the form usable during polling, then blocks on a stock shortage until verification succeeds', async () => {
    const { config, service } = setupPickupCart('powell-background-stock');
    const validator = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
            Response.json({ ...config, revision: config.validation.revision }),
        );
    const placeOrder = jest.fn();
    const shortage = 'Neon Nukes: 0 available at Powell, WY; 1 requested.';

    jest.useFakeTimers();

    try {
        render(
            <Gate checkoutService={service}>
                <input aria-label="Order notes" />
                <button onClick={placeOrder} type="button">
                    Place order
                </button>
            </Gate>,
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'Verifying your warehouse and inventory',
        );
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

        const notes = await screen.findByRole('textbox', { name: 'Order notes' });
        const button = screen.getByRole('button', { name: 'Place order' });
        let finishPoll!: (response: Response) => void;

        validator.mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    finishPoll = resolve;
                }),
        );
        notes.focus();
        await act(async () => jest.advanceTimersByTime(15000));

        expect(validator).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(notes).toBeEnabled();
        expect(notes).toHaveFocus();
        expect(button).toBeEnabled();
        fireEvent.change(notes, { target: { value: 'Pickup after lunch' } });

        await act(async () => {
            finishPoll(
                Response.json({ code: 'INVENTORY_CONFLICT', message: shortage }, { status: 409 }),
            );
        });
        expect(screen.getByRole('alert')).toHaveTextContent(shortage);
        expect(button).toBeDisabled();
        button.click();
        expect(placeOrder).not.toHaveBeenCalled();

        await act(async () => screen.getByRole('button', { name: 'Retry verification' }).click());
        expect(validator).toHaveBeenCalledTimes(3);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(button).toBeEnabled();
        expect(notes).toHaveValue('Pickup after lunch');
    } finally {
        jest.useRealTimers();
        validator.mockRestore();
    }
});

it.each(['verified', 'stale', 'changed', 'unmounted', 'preview'])(
    'holds one payment click through an outstanding background check: %s',
    async (outcome) => {
        const { config, checkout, loadCheckout, service } = setupPickupCart(
            `poll-${outcome}`,
            outcome !== 'preview',
        );
        const original = global.fetch;
        const claims = jest.fn();
        const finalValidation = jest.fn();
        const execute = jest.fn().mockResolvedValue('simulated order');
        const prepare = jest.fn().mockResolvedValue(true);
        const grant = {
            version: 1,
            methodId: 'bigpaypay',
            testMode: true,
            token: 'fixture',
            expiresAt: 9999999999,
        };
        const validator = jest.fn(async (_url, options) => {
            const body = JSON.parse(options.body);

            if (body.testProvider) claims();
            else if (body.submission) finalValidation();

            return {
                ok: true,
                json: async () => ({
                    ...config,
                    revision: 'r1',
                    submission: body.submission,
                    testProviderAuthorization: grant,
                    testProviderClaimed: !!body.testProvider,
                }),
            } as Response;
        });

        global.fetch = validator;

        let attempt: Promise<unknown> | undefined;

        jest.useFakeTimers();

        try {
            const { unmount } = render(
                <Gate checkoutService={service}>
                    <form
                        data-warehouse-validated-submit="true"
                        onSubmit={(event) => {
                            event.preventDefault();
                            attempt = submitWithWarehouseValidation(
                                service,
                                prepare,
                                execute,
                                () => ({
                                    methodId: 'bigpaypay',
                                    selectedMethodId: 'bigpaypay',
                                    customSubmit: false,
                                    usesStoredInstrument: false,
                                    shouldSaveInstrument: false,
                                }),
                            ).catch((error: Error) => error.message);
                        }}
                    >
                        <button id="checkout-payment-continue" type="submit">
                            Place order
                        </button>
                    </form>
                </Gate>,
            );
            const button = await screen.findByRole('button', { name: 'Place order' });
            let finishCheck!: () => void;
            const delayed = new Promise<void>((resolve) => {
                finishCheck = resolve;
            });

            if (outcome === 'stale') {
                validator.mockImplementationOnce(async () => {
                    await delayed;

                    return {
                        ok: false,
                        status: 409,
                        json: async () => ({ message: 'Warehouse selection changed' }),
                    } as Response;
                });
            } else {
                loadCheckout.mockImplementationOnce(async () => {
                    await delayed;
                    if (outcome === 'changed') checkout.grandTotal = 75;
                });
            }

            await act(async () => {
                jest.advanceTimersByTime(15000);
            });
            expect(validator).toHaveBeenCalledTimes(2);
            expect(button).toBeEnabled();
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
            act(() => button.click());
            expect(screen.getByRole('status')).toHaveTextContent('Verifying order');
            expect(button).toBeDisabled();
            act(() => button.click());
            expect(finalValidation).not.toHaveBeenCalled();
            expect(prepare).not.toHaveBeenCalled();
            expect(claims).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();

            if (outcome === 'unmounted') unmount();
            await act(async () => {
                finishCheck();
                await attempt;
            });

            if (outcome === 'verified') {
                await expect(attempt).resolves.toBe('simulated order');
                expect(finalValidation).toHaveBeenCalledTimes(1);
                expect(claims).toHaveBeenCalledTimes(1);
                expect(execute).toHaveBeenCalledTimes(1);
            } else {
                const reason =
                    outcome === 'stale'
                        ? 'Warehouse selection changed'
                        : outcome === 'preview'
                          ? 'Preview only'
                          : 'Checkout changed';

                await expect(attempt).resolves.toContain(reason);
                if (outcome === 'preview') expect(finalValidation).toHaveBeenCalledTimes(1);
                if (outcome === 'stale')
                    expect(screen.getByRole('alert')).toHaveTextContent(reason);
                expect(claims).not.toHaveBeenCalled();
                expect(execute).not.toHaveBeenCalled();
            }
        } finally {
            jest.useRealTimers();
            global.fetch = original;
        }
    },
);
it('keeps payment disabled and shows recovery after a consumed claim even if ordinary validation offers a grant', async () => {
    const config: any = {
        version: 1,
        preview: true,
        cartId: 'synthetic-gate',
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
                allowTestProvider: true,
            },
        ],
    });

    const grant: any = {
        version: 1,
        methodId: 'bigpaypay',
        testMode: true,
        token: 'synthetic-grant',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
    };

    acceptTestProviderAuthorization(grant);
    beginTestProviderAttempt({
        methodId: 'bigpaypay',
        selectedMethodId: 'bigpaypay',
        customSubmit: false,
        usesStoredInstrument: false,
        shouldSaveInstrument: false,
    });

    const original = global.fetch;

    global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ ...config, revision: 'r', testProviderAuthorization: grant }),
    })) as any;

    const service: any = {
        getState: () => ({
            data: {
                getCheckout: () => ({ id: config.cartId }),
                getCart: () => ({}),
                getConsignments: () => [],
            },
        }),
        loadCheckout: jest.fn().mockResolvedValue(undefined),
        subscribe: () => () => {},
    };

    try {
        render(
            <Gate checkoutService={service}>
                <button>Place order</button>
            </Gate>,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled(),
        );
        expect(await screen.findByRole('alert')).toHaveTextContent('Do not submit again');
        expect(
            screen.queryByRole('button', { name: 'Retry verification' }),
        ).not.toBeInTheDocument();
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    } finally {
        global.fetch = original;
    }
});

it('locks an already open tab when another tab persists the attempt', async () => {
    const config: any = {
        version: 1,
        preview: true,
        cartId: 'synthetic-other-tab',
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

    const original = global.fetch;

    global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ ...config, revision: 'r' }),
    })) as any;

    const service: any = {
        getState: () => ({
            data: {
                getCheckout: () => ({ id: config.cartId }),
                getCart: () => ({}),
                getConsignments: () => [],
            },
        }),
        loadCheckout: jest.fn().mockResolvedValue(undefined),
        subscribe: () => () => {},
    };

    try {
        render(
            <Gate checkoutService={service}>
                <button>Place order</button>
            </Gate>,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled(),
        );
        act(() => {
            window.localStorage.setItem(
                `warehouse-submission-recovery:v1:${config.validation.endpoint}:${config.cartId}`,
                'attempted',
            );
            window.dispatchEvent(new StorageEvent('storage'));
        });
        expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('Do not submit again');
    } finally {
        global.fetch = original;
        window.localStorage.clear();
    }
});
it('loads server recovery before attempting to refresh a converted cart', async () => {
    const config: any = {
        version: 1,
        preview: true,
        cartId: 'synthetic-converted-cart',
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

    const original = global.fetch;

    global.fetch = jest.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
            version: 1,
            cartId: config.cartId,
            revision: 'r',
            code: 'SUBMISSION_REVIEW_REQUIRED',
            recovery: { status: 'review_required' },
        }),
    })) as any;

    const service: any = {
        getState: () => ({
            data: {
                getCheckout: () => ({ id: config.cartId }),
                getCart: () => ({}),
                getConsignments: () => [],
            },
        }),
        loadCheckout: jest.fn().mockRejectedValue(new Error('cart converted')),
        subscribe: () => () => {},
    };

    try {
        render(
            <Gate checkoutService={service}>
                <button>Place order</button>
            </Gate>,
        );
        expect(await screen.findByRole('alert')).toHaveTextContent('Do not submit again');
        expect(service.loadCheckout).not.toHaveBeenCalled();
        expect(
            screen.queryByRole('button', { name: 'Retry verification' }),
        ).not.toBeInTheDocument();
    } finally {
        global.fetch = original;
        window.localStorage.clear();
    }
});
