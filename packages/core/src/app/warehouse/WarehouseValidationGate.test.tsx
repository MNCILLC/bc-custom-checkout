import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { getWarehouseDeployment } from './deployment';
import { acceptTestProviderAuthorization, beginTestProviderAttempt } from './testProvider';
import Gate from './WarehouseValidationGate';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));
afterEach(() => {
    cleanup();
    delete window.warehouseCheckout;
});
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
