import {
    type CheckoutService,
    createCheckoutService,
    createEmbeddedCheckoutMessenger,
    type EmbeddedCheckoutMessenger,
} from '@bigcommerce/checkout-sdk';
import userEvent from '@testing-library/user-event';
import { noop } from 'lodash';
import { http, HttpResponse } from 'msw';
import React, { type FunctionComponent } from 'react';

import { ExtensionService } from '@bigcommerce/checkout/checkout-extension';
import {
    type AnalyticsEvents,
    AnalyticsProviderMock,
    CheckoutProvider,
    ExtensionProvider,
    type ExtensionServiceInterface,
    LocaleProvider,
    ThemeProvider,
} from '@bigcommerce/checkout/contexts';
import { replaceLocation } from '@bigcommerce/checkout/dom-utils';
import { getLanguageService } from '@bigcommerce/checkout/locale';
import { CHECKOUT_ROOT_NODE_ID } from '@bigcommerce/checkout/payment-integration-api';
import {
    CheckoutPageNodeObject,
    CheckoutPreset,
    checkoutSettings,
    checkoutWithBillingEmail,
    checkoutWithShippingAndBilling,
    payments,
} from '@bigcommerce/checkout/test-framework';
import { renderWithoutWrapper as render, screen, waitFor } from '@bigcommerce/checkout/test-utils';

import Checkout, { type CheckoutProps } from '../checkout/Checkout';
import { createErrorLogger } from '../common/error';
import {
    createEmbeddedCheckoutStylesheet,
    createEmbeddedCheckoutSupport,
} from '../embeddedCheckout';
import { installPurchaseGuards } from '../warehouse/purchaseGuards';
import * as warehouseSubmission from '../warehouse/submission';

jest.mock('@bigcommerce/checkout/dom-utils', () => ({
    ...jest.requireActual('@bigcommerce/checkout/dom-utils'),
    replaceLocation: jest.fn(),
}));

describe('Guarded preview payment form', () => {
    let removePurchaseGuards: (() => void) | undefined;
    let checkout: CheckoutPageNodeObject;
    let CheckoutTest: FunctionComponent<CheckoutProps>;
    let checkoutService: CheckoutService;
    let extensionService: ExtensionServiceInterface;
    let defaultProps: CheckoutProps;
    let embeddedMessengerMock: EmbeddedCheckoutMessenger;
    let analyticsTracker: Partial<AnalyticsEvents>;

    const enhancedThemeV1Config = {
        ...checkoutSettings,
        storeConfig: {
            ...checkoutSettings.storeConfig,
            checkoutSettings: {
                ...checkoutSettings.storeConfig.checkoutSettings,
                enableTermsAndConditions: true,
                orderTermsAndConditions: 'Synthetic test terms',
                checkoutUserExperienceSettings: {
                    ...checkoutSettings.storeConfig.checkoutSettings.checkoutUserExperienceSettings,
                    enhancedCheckoutThemeV1: true,
                },
            },
        },
    };

    beforeAll(() => {
        checkout = new CheckoutPageNodeObject();
        checkout.goto();
    });

    afterEach(() => {
        checkout.resetHandlers();
        sessionStorage.clear();
        removePurchaseGuards?.();
        delete window.warehouseCheckout;
        jest.restoreAllMocks();
    });

    afterAll(() => {
        checkout.close();
    });

    beforeEach(() => {
        window.scrollTo = jest.fn();

        (replaceLocation as jest.Mock).mockClear();

        checkoutService = createCheckoutService();
        extensionService = new ExtensionService(checkoutService, createErrorLogger());
        embeddedMessengerMock = createEmbeddedCheckoutMessenger({
            parentOrigin: 'https://store.url',
        });
        defaultProps = {
            checkoutId: checkoutWithBillingEmail.id,
            containerId: CHECKOUT_ROOT_NODE_ID,
            createEmbeddedMessenger: () => embeddedMessengerMock,
            embeddedStylesheet: createEmbeddedCheckoutStylesheet(),
            embeddedSupport: createEmbeddedCheckoutSupport(getLanguageService()),
            errorLogger: createErrorLogger(),
        };

        jest.spyOn(defaultProps.errorLogger, 'log').mockImplementation(noop);
        analyticsTracker = {
            selectedPaymentMethod: jest.fn(),
        };

        CheckoutTest = (props) => (
            <CheckoutProvider checkoutService={checkoutService}>
                <LocaleProvider
                    checkoutService={checkoutService}
                    languageService={getLanguageService()}
                >
                    <AnalyticsProviderMock analyticsTracker={analyticsTracker}>
                        <ExtensionProvider extensionService={extensionService}>
                            <ThemeProvider>
                                <Checkout {...props} />
                            </ThemeProvider>
                        </ExtensionProvider>
                    </AnalyticsProviderMock>
                </LocaleProvider>
            </CheckoutProvider>
        );
    });

    it.each([200, 409, 503])(
        'reaches the preview block through normal clicks after validator status %s',
        async (status) => {
            const fixture = {
                ...checkoutWithShippingAndBilling,
                consignments: checkoutWithShippingAndBilling.consignments.map((consignment) => ({
                    ...consignment,
                    selectedShippingOption: {
                        id: 'synthetic-freight',
                        description: 'Synthetic Freight',
                        additionalDescription: '',
                        isRecommended: false,
                        costAfterDiscount: 10,
                        imageUrl: '',
                        cost: 10,
                        transitTime: '',
                        type: 'shipping_carrier',
                    },
                })),
            };

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithShippingAndBilling, {
                config: enhancedThemeV1Config,
                checkout: fixture,
            });
            checkout.setRequestHandler(
                http.get('/api/storefront/checkout/*', () => HttpResponse.json(fixture)),
            );

            checkout.setRequestHandler(
                http.get('/api/storefront/checkout-settings', () =>
                    HttpResponse.json(enhancedThemeV1Config),
                ),
            );

            const cheque = {
                ...payments[0],
                id: 'cheque',
                config: { ...payments[0].config, displayName: 'Check' },
            };

            checkout.setRequestHandler(
                http.get('/api/storefront/payments', () =>
                    HttpResponse.json([payments[0], cheque]),
                ),
            );

            const validationRequests: unknown[] = [];

            checkout.setRequestHandler(
                http.post('https://warehouse.example/validate', async ({ request }) => {
                    const body = (await request.json()) as { submission?: unknown };

                    validationRequests.push(body);

                    if (status !== 200 && validationRequests.length === 1)
                        return HttpResponse.json(
                            { message: 'Synthetic validation failure. Return to cart.' },
                            { status },
                        );

                    return HttpResponse.json({
                        version: 1,
                        cartId: checkoutWithShippingAndBilling.id,
                        revision: 'test-revision',
                        warehouse: window.warehouseCheckout?.warehouse,
                        submission: body.submission,
                    });
                }),
            );

            const nativeSubmit = jest
                .spyOn(checkoutService, 'submitOrder')
                .mockRejectedValue(new Error('Unexpected order submission'));
            const guard = jest.spyOn(warehouseSubmission, 'submitWithWarehouseValidation');

            render(<CheckoutTest {...defaultProps} />);
            await checkout.waitForPaymentStep();
            await userEvent.click(screen.getByRole('radio', { name: 'Check' }));
            await waitFor(() =>
                expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled(),
            );
            window.warehouseCheckout = {
                version: 1,
                preview: true,
                cartId: checkoutWithShippingAndBilling.id,
                validation: {
                    endpoint: 'https://warehouse.example/validate',
                    token: 'synthetic-only',
                    revision: 'test-revision',
                    expiresAt: 9999999999,
                },
                warehouse: {
                    id: 'origin',
                    label: 'Origin',
                    pickupLabel: 'Origin pickup',
                    locationId: 1,
                    pickupMethodId: 2,
                    allowShipping: true,
                },
            };
            removePurchaseGuards = installPurchaseGuards();
            // Required terms still stop Formik before any submit-time request.
            await userEvent.click(screen.getByRole('button', { name: /place order/i }));
            expect(guard).not.toHaveBeenCalled();
            expect(validationRequests).toHaveLength(0);
            await userEvent.click(screen.getByRole('checkbox', { name: /agree with/ }));
            await userEvent.click(screen.getByRole('button', { name: /place order/i }));
            await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

            if (status !== 200) {
                expect(
                    await screen.findByText('Synthetic validation failure. Return to cart.'),
                ).toBeInTheDocument();
                expect(nativeSubmit).not.toHaveBeenCalled();
                await userEvent.click(screen.getByRole('button', { name: /^ok$/i }));
                await userEvent.click(screen.getByRole('button', { name: /place order/i }));
                await waitFor(() => expect(guard).toHaveBeenCalledTimes(2));
            }

            await expect(guard.mock.results.at(-1)?.value).rejects.toThrow('Preview only');
            expect(
                await screen.findByText(
                    'Warehouse verified. Preview only: no order was submitted.',
                ),
            ).toBeInTheDocument();
            expect(validationRequests).toHaveLength(status === 200 ? 1 : 2);
            validationRequests.forEach((request) =>
                expect(request).not.toHaveProperty('checkTest'),
            );
            expect(replaceLocation).not.toHaveBeenCalled();
            expect(nativeSubmit).not.toHaveBeenCalled();
            guard.mockRestore();
        },
    );
});
