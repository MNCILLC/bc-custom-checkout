import {
    createCheckoutService,
    type CustomerInitializeOptions,
    type PaymentInitializeOptions,
} from '@bigcommerce/checkout-sdk';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';

import {
    assertPaymentProviderAllowed,
    isPaymentProviderAllowed,
    type PaymentFormService,
    type PaymentMethodProps,
} from '@bigcommerce/checkout/payment-integration-api';

// Exercise provider entry points without loading unrelated integrations from the barrel.
// eslint-disable-next-line @nx/enforce-module-boundaries
import BigCommercePaymentsButton from '../../../../bigcommerce-payments-integration/src/BigCommercePayments/BigCommercePaymentsButton';
// This internal component is the wallet callback boundary under test.
// eslint-disable-next-line @nx/enforce-module-boundaries
import WalletComponent from '../../../../bigcommerce-payments-integration/src/components/BigCommercePaymentsPaymentMethodComponent';

import { type WarehouseCheckoutConfig } from './config';
import * as deployment from './deployment';
import { acceptPaymentGrants } from './paymentAuthorization';
import { installPurchaseGuards } from './purchaseGuards';
import { requireSubmissionReview } from './recovery';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));

let remove: (() => void) | undefined;
let count = 0;
const fixture = (): WarehouseCheckoutConfig => ({
    version: 1,
    preview: true,
    cartId: `synthetic-${++count}`,
    validation: {
        endpoint: 'https://validator.example/validate',
        token: 'synthetic-only',
        revision: 'v1',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'origin',
        label: 'Origin',
        pickupLabel: 'Pickup',
        locationId: 71,
        pickupMethodId: 81,
        allowShipping: true,
    },
});

function activate() {
    jest.mocked(deployment.getWarehouseDeployment).mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: 'https://validator.example/validate',
            },
        ],
    });
    window.warehouseCheckout = fixture();
}

function ordinary() {
    jest.mocked(deployment.getWarehouseDeployment).mockReturnValue({ mode: 'off', stores: [] });
    delete window.warehouseCheckout;
}

beforeEach(() => {
    activate();
    remove = installPurchaseGuards();
});
afterEach(() => {
    cleanup();
    remove?.();
    delete window.warehouseCheckout;
    window.localStorage.clear();
    jest.restoreAllMocks();
});

it.each([
    'bigcommerce_payments',
    'bigcommerce_payments_venmo',
    'bigcommerce_payments_paylater',
    'bigcommerce_payments_creditcards',
    'unknown',
    undefined,
])('denies unsupported provider %s even without a test grant', (method) => {
    expect(() => assertPaymentProviderAllowed(method, 'payment')).toThrow();
    expect(isPaymentProviderAllowed(method, 'payment')).toBe(false);
});
it.each(['bigpaypay', 'cheque'])(
    'permits the native %s form but never an express wallet',
    (method) => {
        expect(() => assertPaymentProviderAllowed(method, 'payment')).not.toThrow();
        expect(() => assertPaymentProviderAllowed(method, 'express')).toThrow();
    },
);
it.each(['missing', 'expired', 'recovery'])(
    'denies native form initialization with %s handoff',
    (state) => {
        if (state === 'missing') delete window.warehouseCheckout;
        if (state === 'expired' && window.warehouseCheckout)
            window.warehouseCheckout.validation.expiresAt = 1;
        if (state === 'recovery') requireSubmissionReview();
        expect(() => assertPaymentProviderAllowed('bigpaypay', 'payment')).toThrow();
    },
);
it('shows only the granted local card and gateway on the normal payment form', () => {
    const pair = { methodId: 'fixture-card', gatewayId: 'fixture-gateway' };
    const grant = {
        ...pair,
        version: 1 as const,
        testMode: true,
        token: 'fixture-grant',
        expiresAt: 9999999999,
    };
    const store = {
        checkoutOrigin: window.location.origin,
        validationEndpoint: 'https://validator.example/validate',
        allowTestProvider: true,
        localCardPreview: pair,
    };
    const configure = jest.mocked(deployment.getWarehouseDeployment);
    const allowed = () => isPaymentProviderAllowed(pair.methodId, 'payment', pair.gatewayId);

    configure.mockReturnValue({ mode: 'development', stores: [store] });

    try {
        expect(allowed()).toBe(false);
        acceptPaymentGrants([grant]);
        expect(allowed()).toBe(true);
        expect(isPaymentProviderAllowed(pair.methodId, 'payment')).toBe(false);
        expect(isPaymentProviderAllowed(pair.methodId, 'payment', 'other-gateway')).toBe(false);
        expect(isPaymentProviderAllowed('other-card', 'payment', pair.gatewayId)).toBe(false);
        expect(isPaymentProviderAllowed(pair.methodId, 'express', pair.gatewayId)).toBe(false);
        configure.mockReturnValue({ mode: 'staging', stores: [store] });
        expect(allowed()).toBe(false);
        configure.mockReturnValue({ mode: 'development', stores: [store] });
        acceptPaymentGrants([{ ...grant, gatewayId: 'other-gateway' }]);
        expect(isPaymentProviderAllowed(pair.methodId, 'payment', 'other-gateway')).toBe(false);
        acceptPaymentGrants([]);
        expect(allowed()).toBe(false);
        acceptPaymentGrants([grant]);
        requireSubmissionReview();
        expect(allowed()).toBe(false);
    } finally {
        acceptPaymentGrants(undefined);
    }
});
it('preserves ordinary checkout with no warehouse handoff', () => {
    ordinary();
    expect(() => assertPaymentProviderAllowed('bigcommerce_payments', 'payment')).not.toThrow();
    expect(() => assertPaymentProviderAllowed('bigcommerce_payments', 'express')).not.toThrow();
});

function wallet(methodId: string) {
    const service = createCheckoutService();
    const initialize = jest
        .spyOn(service, 'initializePayment')
        .mockResolvedValue(service.getState());

    jest.spyOn(service, 'deinitializePayment').mockResolvedValue(service.getState());

    const submitted = jest.fn();
    const disabled = jest.fn();
    const error = jest.fn();
    const validateForm = jest.fn().mockResolvedValue({});
    const ensureBillingAddressSaved = jest.fn().mockResolvedValue(true);
    const form = {
        getFieldValue: jest.fn(() => false),
        validateForm,
        ensureBillingAddressSaved,
        hidePaymentSubmitButton: jest.fn(),
        setSubmitted: jest.fn(),
        setFieldTouched: jest.fn(),
        disableSubmit: disabled,
        submitForm: submitted,
    } as unknown as PaymentFormService;
    const props = {
        method: { id: methodId },
        checkoutService: service,
        paymentForm: form,
        onUnhandledError: error,
    } as unknown as PaymentMethodProps;

    render(<WalletComponent {...props} providerOptionsKey={methodId} />);

    return { initialize, submitted, disabled, error, validateForm, ensureBillingAddressSaved };
}

interface WalletOptions {
    onValidate(resolve: () => void, reject: () => void): Promise<void>;
    submitForm(): void;
    onInit(render: () => void): void;
}

function options(init: jest.SpyInstance, methodId: string): WalletOptions {
    return (init.mock.calls[0][0] as PaymentInitializeOptions & Record<string, unknown>)[
        methodId
    ] as WalletOptions;
}

for (const method of [
    'bigcommerce_payments',
    'bigcommerce_payments_venmo',
    'bigcommerce_payments_paylater',
]) {
    it(`never initializes the ${method} widget in warehouse preview`, () => {
        const state = wallet(method);

        expect(state.initialize).not.toHaveBeenCalled();
        expect(state.error).toHaveBeenCalledTimes(1);
        expect(state.submitted).not.toHaveBeenCalled();
    });
    it.each(['blocked', 'expired', 'recovery'])(
        `rechecks a previously mounted ${method} callback on %s`,
        async (state) => {
            ordinary();

            const widget = wallet(method);

            expect(widget.initialize).toHaveBeenCalledTimes(1);

            const current = options(widget.initialize, method);

            activate();
            if (state === 'expired' && window.warehouseCheckout)
                window.warehouseCheckout.validation.expiresAt = 1;
            if (state === 'recovery') requireSubmissionReview();

            const allow = jest.fn();
            const deny = jest.fn();

            await act(async () => {
                await current.onValidate(allow, deny);
                current.submitForm();
            });
            expect(allow).not.toHaveBeenCalled();
            expect(deny).toHaveBeenCalledTimes(1);
            expect(widget.submitted).not.toHaveBeenCalled();
        },
    );
}

it('rechecks the policy after asynchronous billing validation', async () => {
    ordinary();

    const widget = wallet('bigcommerce_payments');
    const current = options(widget.initialize, 'bigcommerce_payments');
    let finish: (value: boolean) => void = () => {
        throw new Error('Billing was not started');
    };
    let billingStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
        billingStarted = resolve;
    });

    widget.ensureBillingAddressSaved.mockImplementation(
        () =>
            new Promise<boolean>((resolve) => {
                finish = resolve;
                billingStarted();
            }),
    );

    const allow = jest.fn();
    const deny = jest.fn();

    await act(async () => {
        const validation = current.onValidate(allow, deny);

        await started;
        expect(widget.ensureBillingAddressSaved).toHaveBeenCalledTimes(1);
        activate();
        finish(true);
        await validation;
    });
    expect(allow).not.toHaveBeenCalled();
    expect(deny).toHaveBeenCalledTimes(1);
});

function express() {
    const service = createCheckoutService();
    const initialize = jest
        .spyOn(service, 'initializeCustomer')
        .mockResolvedValue(service.getState());

    jest.spyOn(service, 'deinitializeCustomer').mockResolvedValue(service.getState());

    const error = jest.fn();

    render(
        <BigCommercePaymentsButton
            checkoutService={service}
            checkoutState={service.getState()}
            containerId="wallet-fixture"
            language={{} as never}
            methodId="bigcommerce_payments"
            onUnhandledError={error}
        />,
    );

    return { initialize, error };
}

it('prevents express initialization before any provider iframe can be created', () => {
    const provider = express();

    expect(provider.initialize).not.toHaveBeenCalled();
    // Provider frames have no accessible role; inspect their absence explicitly.
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector('iframe')).toBeNull();
    expect(provider.error).toHaveBeenCalledTimes(1);
});
it.each(['blocked', 'expired', 'recovery'])(
    'rechecks a previously mounted express click with %s state',
    (state) => {
        ordinary();

        const provider = express();

        expect(provider.initialize).toHaveBeenCalledTimes(1);

        const init = provider.initialize.mock.calls[0][0] as CustomerInitializeOptions & {
            bigcommerce_payments: { onClick: () => void };
        };

        activate();
        if (state === 'expired' && window.warehouseCheckout)
            window.warehouseCheckout.validation.expiresAt = 1;
        if (state === 'recovery') requireSubmissionReview();
        expect(() => init.bigcommerce_payments.onClick()).toThrow();
    },
);
