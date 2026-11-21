import {
    type CheckoutService,
    createCheckoutService,
    type LanguageService,
} from '@bigcommerce/checkout-sdk';
import { act, fireEvent, waitFor } from '@testing-library/react';
import React, { type FunctionComponent } from 'react';

import { CheckoutProvider, type LocaleContextType } from '@bigcommerce/checkout/contexts';
import { createLocaleContext } from '@bigcommerce/checkout/locale';
import { render, screen } from '@bigcommerce/checkout/test-utils';

import { getCart } from '../cart/carts.mock';
import { getStoreConfig } from '../config/config.mock';
import { getWarehouseDeployment } from '../warehouse/deployment';
import { testProviderAuthorization } from '../warehouse/testProvider';
import WarehouseValidationGate from '../warehouse/WarehouseValidationGate';

import { PaymentMethodId, PaymentMethodType } from './paymentMethod';
import PaymentSubmitButton, { type PaymentSubmitButtonProps } from './PaymentSubmitButton';

jest.mock('../warehouse/deployment', () => ({ getWarehouseDeployment: jest.fn() }));

describe('PaymentSubmitButton', () => {
    let PaymentSubmitButtonTest: FunctionComponent<PaymentSubmitButtonProps>;
    let checkoutService: CheckoutService;
    let languageService: LanguageService;
    let localeContext: LocaleContextType;

    beforeEach(() => {
        jest.mocked(getWarehouseDeployment).mockReturnValue({ mode: 'off', stores: [] });
        checkoutService = createCheckoutService();
        localeContext = createLocaleContext(getStoreConfig());
        languageService = localeContext.language;

        PaymentSubmitButtonTest = (props) => (
            <CheckoutProvider checkoutService={checkoutService}>
                <PaymentSubmitButton isPaymentDataRequired {...props} />
            </CheckoutProvider>
        );
    });

    it.each([
        {
            limit: 'line item',
            initialQuantity: 5,
            reason: { code: 'MAX_LINE_ITEMS_EXCEEDED', maxLineItems: 1 },
            warning: 'one line item per order',
        },
        {
            limit: 'quantity',
            initialQuantity: 5,
            reason: { code: 'MAX_QUANTITY_EXCEEDED', maxQuantity: 5 },
            warning: 'up to 5 units per order',
        },
        {
            limit: 'total',
            initialQuantity: 3,
            reason: { code: 'MAX_GRAND_TOTAL_EXCEEDED', maxGrandTotal: 948.38, currency: 'USD' },
            warning:
                'The maximum order total is $948.38. Return to your cart and reduce the total to continue.',
        },
    ])('handles the pickup $limit limit', async ({ limit, initialQuantity, reason, warning }) => {
        const cart = getCart();

        cart.lineItems.digitalItems = [];

        const endpoint = 'https://validator.example/validate';
        const forney = limit === 'total';
        const config = {
            version: 1 as const,
            preview: true as const,
            cartId: cart.id,
            validation: {
                endpoint,
                token: 'synthetic-cart',
                revision: 'r1',
                expiresAt: 9999999999,
            },
            warehouse: {
                id: forney ? 'forney' : 'powell',
                label: forney ? 'Forney' : 'Powell',
                pickupLabel: forney ? 'Forney pickup' : 'Powell pickup',
                locationId: forney ? 1 : 2,
                pickupMethodId: forney ? 1 : 2,
                allowShipping: forney,
            },
        };
        const originalFetch = global.fetch;

        jest.mocked(getWarehouseDeployment).mockReturnValue({
            mode: 'staging',
            stores: [
                {
                    checkoutOrigin: window.location.origin,
                    validationEndpoint: endpoint,
                    allowTestProvider: true,
                    allowCheckTest: false,
                },
            ],
        });

        const items = cart.lineItems.physicalItems;
        const first = items[0];

        first.quantity = initialQuantity;
        if (forney)
            Object.assign(first, {
                name: 'The Showgirl',
                sku: 'CBFT003',
                productId: 243,
                salePrice: 239.6,
            });

        let generation = 0;
        const validate = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
            expect(url).toBe(endpoint);
            expect(init?.body).toBe(JSON.stringify({ cartId: cart.id, revision: 'r1' }));
            generation += 1;

            const overTotal = forney && first.quantity * first.salePrice > 948.38;
            const result =
                overTotal || first.quantity > 5 || items.length > 1
                    ? { testProviderIneligibility: reason }
                    : {
                          testProviderAuthorization: {
                              version: 1,
                              methodId: 'bigpaypay',
                              testMode: true,
                              expiresAt: 9999999999,
                              token: `grant-${generation}`,
                          },
                      };

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    ...result,
                    version: 1,
                    cartId: cart.id,
                    revision: 'r1',
                    warehouse: config.warehouse,
                }),
            } as Response;
        });
        const sdkSubmit = jest.spyOn(checkoutService, 'submitOrder');
        const refresh = () =>
            act(() => {
                window.dispatchEvent(new Event('focus'));
            });

        jest.spyOn(checkoutService.getState().data, 'getCart').mockReturnValue(cart);
        window.warehouseCheckout = config;
        global.fetch = validate;

        try {
            render(
                <WarehouseValidationGate checkoutService={checkoutService}>
                    <PaymentSubmitButtonTest methodId="bigpaypay" />
                </WarehouseValidationGate>,
            );

            const placeOrder = await screen.findByRole('button', { name: /place order/i });

            await waitFor(() => expect(placeOrder).toBeEnabled());

            const initial = testProviderAuthorization();

            expect(initial).toBeDefined();
            if (limit !== 'line item') first.quantity += 1;
            else
                items.push({
                    ...first,
                    id: 'second-line',
                    productId: first.productId + 1,
                    sku: 'SECOND',
                });
            await refresh();
            expect(await screen.findByRole('alert')).toHaveTextContent(warning);
            expect(placeOrder).toHaveAccessibleDescription(/return to your cart/i);
            expect(placeOrder).toBeDisabled();
            expect(testProviderAuthorization()).toBeUndefined();
            fireEvent.click(placeOrder);
            expect(validate).toHaveBeenCalledTimes(2);

            if (limit !== 'line item') first.quantity = initialQuantity;
            else items.pop();
            await refresh();
            await waitFor(() => expect(placeOrder).toBeEnabled());
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(placeOrder).not.toHaveAttribute('aria-describedby');
            expect(testProviderAuthorization()?.token).toBe('grant-3');
            expect(testProviderAuthorization()?.token).not.toBe(initial?.token);
            expect(sdkSubmit).not.toHaveBeenCalled();
        } finally {
            delete window.warehouseCheckout;
            global.fetch = originalFetch;
            jest.mocked(getWarehouseDeployment).mockReturnValue({ mode: 'off', stores: [] });
        }
    });

    it('renders button with default label', () => {
        render(<PaymentSubmitButtonTest />);

        expect(
            screen.getByText(languageService.translate('payment.place_order_action')),
        ).toBeInTheDocument();
    });

    it('renders button with default label if payment data is not required', () => {
        render(<PaymentSubmitButtonTest isPaymentDataRequired={false} />);

        expect(
            screen.getByText(languageService.translate('payment.place_order_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for Amazon Pay', () => {
        render(<PaymentSubmitButtonTest methodId="amazonpay" />);

        expect(
            screen.getByText(languageService.translate('payment.amazonpay_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label and icon for Bolt', () => {
        render(<PaymentSubmitButtonTest methodId="bolt" />);

        expect(screen.getByTestId('bolt-icon')).toBeInTheDocument();
        expect(screen.getByText('Bolt')).toBeInTheDocument();
        expect(
            screen.getByText(languageService.translate('payment.place_order_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for Visa Checkout provided by Braintree', () => {
        render(<PaymentSubmitButtonTest methodType="visa-checkout" />);

        expect(
            screen.getByText(languageService.translate('payment.visa_checkout_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for PayPal', () => {
        render(<PaymentSubmitButtonTest isComplete={true} methodType="paypal" />);

        expect(
            screen.getByText(languageService.translate('payment.paypal_complete_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for PayPal when the order placement starts on checkout page', () => {
        render(<PaymentSubmitButtonTest methodType="paypal" />);

        expect(
            screen.getByText(languageService.translate('payment.paypal_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with "place order" label for PayPal when the order placement starts on checkout page', () => {
        render(
            <PaymentSubmitButtonTest
                methodId={PaymentMethodId.PaypalCommerce}
                methodType="paypal"
            />,
        );

        expect(
            screen.getByText(languageService.translate('payment.place_order_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for Braintree Venmo', () => {
        render(
            <PaymentSubmitButtonTest
                methodId={PaymentMethodId.BraintreeVenmo}
                methodType="paypal"
            />,
        );

        expect(
            screen.getByText(languageService.translate('payment.paypal_venmo_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for PayPal Venmo', () => {
        render(<PaymentSubmitButtonTest methodType={PaymentMethodType.PaypalVenmo} />);

        expect(
            screen.getByText(languageService.translate('payment.paypal_venmo_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for PayPal Credit', () => {
        render(<PaymentSubmitButtonTest isComplete={true} methodType="paypal-credit" />);

        expect(
            screen.getByText(languageService.translate('payment.paypal_pay_later_complete_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for PayPal Credit when the order placement starts on checkout page', () => {
        render(<PaymentSubmitButtonTest methodType="paypal-credit" />);

        expect(
            screen.getByText(languageService.translate('payment.paypal_pay_later_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for Quadpay', () => {
        render(<PaymentSubmitButtonTest methodId="quadpay" />);

        expect(
            screen.getByText(languageService.translate('payment.quadpay_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with special label for Zip', () => {
        render(<PaymentSubmitButtonTest methodId="zip" />);

        expect(
            screen.getByText(languageService.translate('payment.zip_continue_action')),
        ).toBeInTheDocument();
    });

    it('renders button with label of "Continue with ${methodName}"', () => {
        render(<PaymentSubmitButtonTest initialisationStrategyType="none" methodName="Foo" />);

        expect(
            screen.getByText(
                languageService.translate('payment.ppsdk_continue_action', { methodName: 'Foo' }),
            ),
        ).toBeInTheDocument();
    });
});
