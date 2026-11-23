import {
    type CheckoutService,
    createCheckoutService,
    createEmbeddedCheckoutMessenger,
    type EmbeddedCheckoutMessenger,
} from '@bigcommerce/checkout-sdk';
import userEvent from '@testing-library/user-event';
import { noop } from 'lodash';
import React, { type FunctionComponent } from 'react';

import { ExtensionService } from '@bigcommerce/checkout/checkout-extension';
import {
    AnalyticsProviderMock,
    CapabilitiesContext,
    CheckoutProvider,
    defaultCapabilities,
    ExtensionProvider,
    type ExtensionServiceInterface,
    LocaleProvider,
    ThemeProvider,
} from '@bigcommerce/checkout/contexts';
import { getLanguageService } from '@bigcommerce/checkout/locale';
import { CHECKOUT_ROOT_NODE_ID } from '@bigcommerce/checkout/payment-integration-api';
import {
    CheckoutPageNodeObject,
    CheckoutPreset,
    checkoutSettings,
    checkoutWithBillingEmail,
    checkoutWithCustomerHavingInvalidAddress,
    checkoutWithLoggedInCustomer,
    checkoutWithMultiShippingCart,
    checkoutWithShipping,
    checkoutWithShippingAndBilling,
    consignment,
    customer,
    payments,
    shippingAddress,
    shippingQuoteFailedMessage,
} from '@bigcommerce/checkout/test-framework';
import {
    renderWithoutWrapper as render,
    screen,
    waitFor,
    within,
} from '@bigcommerce/checkout/test-utils';

import { getCustomerAddressB2B } from '../address/address.mock';
import Checkout, { type CheckoutProps } from '../checkout/Checkout';
import { createErrorLogger } from '../common/error';
import {
    createEmbeddedCheckoutStylesheet,
    createEmbeddedCheckoutSupport,
} from '../embeddedCheckout';
import * as warehouseConfig from '../warehouse/config';
import * as freight from '../warehouse/freight';
import { WarehouseShippingContext } from '../warehouse/WarehouseShippingContext';

describe('Shipping step', () => {
    let checkout: CheckoutPageNodeObject;
    let CheckoutTest: FunctionComponent<CheckoutProps>;
    let checkoutService: CheckoutService;
    let extensionService: ExtensionServiceInterface;
    let defaultProps: CheckoutProps;
    let embeddedMessengerMock: EmbeddedCheckoutMessenger;

    beforeAll(() => {
        checkout = new CheckoutPageNodeObject();
        checkout.goto();
    });

    afterEach(() => {
        jest.unmock('lodash');
        checkout.resetHandlers();
        sessionStorage.clear();
    });

    afterAll(() => {
        checkout.close();
    });

    beforeEach(() => {
        window.scrollTo = jest.fn();

        checkoutService = createCheckoutService();
        extensionService = new ExtensionService(checkoutService, createErrorLogger());
        embeddedMessengerMock = createEmbeddedCheckoutMessenger({
            parentOrigin: 'https://store.url',
        });
        defaultProps = {
            checkoutId: 'x',
            containerId: CHECKOUT_ROOT_NODE_ID,
            createEmbeddedMessenger: () => embeddedMessengerMock,
            embeddedStylesheet: createEmbeddedCheckoutStylesheet(),
            embeddedSupport: createEmbeddedCheckoutSupport(getLanguageService()),
            errorLogger: createErrorLogger(),
        };

        jest.spyOn(defaultProps.errorLogger, 'log').mockImplementation(noop);
        jest.spyOn(checkoutService, 'updateShippingAddress');
        jest.spyOn(checkoutService, 'updateBillingAddress');

        jest.mock('lodash', () => ({
            ...jest.requireActual('lodash'),
            debounce: (fn: any) => {
                fn.cancel = jest.fn();

                return fn;
            },
        }));

        CheckoutTest = (props) => (
            <CheckoutProvider checkoutService={checkoutService}>
                <LocaleProvider
                    checkoutService={checkoutService}
                    languageService={getLanguageService()}
                >
                    <AnalyticsProviderMock>
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

    describe('Shipping step happy paths', () => {
        it('places Apply and Reload under the selected warehouse shipping address', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            const cartId = checkoutWithMultiShippingCart.id;
            const handoff = jest.spyOn(warehouseConfig, 'getWarehouseCheckout').mockReturnValue({
                version: 1,
                cartId,
                preview: true,
                warehouse: {
                    id: 'forney',
                    label: 'Forney',
                    pickupLabel: 'Forney, TX',
                    locationId: 1,
                    pickupMethodId: 1,
                    allowShipping: true,
                },
                validation: {
                    endpoint: 'https://example.invalid/validate',
                    token: 'test',
                    revision: '1',
                    expiresAt: 9999999999,
                },
            });
            const endpoint = jest
                .spyOn(freight, 'freightEndpoint')
                .mockReturnValue('https://example.invalid/freight');
            const load = jest.spyOn(freight, 'loadFreightPreferences').mockResolvedValue({
                version: 1,
                cartId,
                revision: '1',
                preferences: null,
                services: [],
            });

            try {
                render(<CheckoutTest {...defaultProps} />);

                const picker = await screen.findByTestId('address-select-button');

                expect(
                    screen.queryByRole('button', { name: /Apply delivery options/ }),
                ).not.toBeInTheDocument();
                expect(
                    screen.queryByRole('button', { name: 'Reload preferences' }),
                ).not.toBeInTheDocument();
                checkout.updateCheckout(
                    'post',
                    '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                    {
                        ...checkoutWithMultiShippingCart,
                        consignments: [
                            {
                                ...consignment,
                                shippingAddress: customer.addresses[0],
                                selectedShippingOption: undefined,
                            },
                        ],
                    },
                );
                await userEvent.click(picker);
                await userEvent.click(screen.getByText(/111 Testing Rd/));

                const apply = await screen.findByRole('button', { name: /Apply delivery options/ });
                const reload = screen.getByRole('button', { name: 'Reload preferences' });

                expect(picker.compareDocumentPosition(apply)).toBe(
                    Node.DOCUMENT_POSITION_FOLLOWING,
                );
                expect(apply.compareDocumentPosition(reload)).toBe(
                    Node.DOCUMENT_POSITION_FOLLOWING,
                );

                const reads = load.mock.calls.length;

                await userEvent.click(reload);
                await waitFor(() => expect(load).toHaveBeenCalledTimes(reads + 1));
                expect(picker).toHaveTextContent('111 Testing Rd');
                checkout.updateCheckout(
                    'delete',
                    '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                    checkoutWithMultiShippingCart,
                );
                // The embedded test keeps the menu open after selection in some themes.
                if (!screen.queryByTestId('add-new-address')) await userEvent.click(picker);
                await userEvent.click(screen.getByTestId('add-new-address'));
                await waitFor(() => expect(apply).not.toBeInTheDocument());
                expect(reload).not.toBeInTheDocument();
                expect(screen.getByLabelText('First Name')).toBeVisible();
            } finally {
                load.mockRestore();
                endpoint.mockRestore();
                handoff.mockRestore();
            }
        });

        it('lets a warehouse shopper select a saved address before Freight approval', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            const update = jest.spyOn(checkoutService, 'updateShippingAddress');
            const setAddressBusy = jest.fn();
            const form = (freightReady: boolean) => (
                <WarehouseShippingContext.Provider value={{ freightReady, setAddressBusy }}>
                    <CheckoutTest {...defaultProps} />
                </WarehouseShippingContext.Provider>
            );
            const view = render(form(false));

            const picker = await screen.findByTestId('address-select-button');

            await userEvent.click(picker);
            expect(screen.getByTestId('add-new-address')).toBeVisible();
            expect(screen.getByText(/222 Testing Rd/)).toBeVisible();

            const selected = customer.addresses[0];

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithMultiShippingCart,
                    consignments: [
                        {
                            ...consignment,
                            shippingAddress: selected,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            await userEvent.click(screen.getByText(/111 Testing Rd/));
            await waitFor(() => expect(picker).toHaveTextContent('111 Testing Rd'));
            expect(update).toHaveBeenCalledWith(
                expect.objectContaining({ address1: '111 Testing Rd' }),
                {
                    params: { include: { 'consignments.availableShippingOptions': false } },
                },
            );
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
            expect(screen.queryByText(/Shipping method/i)).not.toBeInTheDocument();
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithMultiShippingCart,
                    consignments: [{ ...consignment, shippingAddress: selected }],
                },
            );
            view.rerender(form(true));
            await checkout.waitForShippingStep();
            expect(screen.getByTestId('address-select-button')).toBe(picker);
            expect(picker).toHaveTextContent('111 Testing Rd');
        });

        it('offers freight actions only after a newly entered shipping address is accepted', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithLoggedInCustomer);

            const setFreightActionsTarget = jest.fn();

            render(
                <WarehouseShippingContext.Provider
                    value={{ freightReady: false, setAddressBusy: noop, setFreightActionsTarget }}
                >
                    <CheckoutTest {...defaultProps} />
                </WarehouseShippingContext.Provider>,
            );

            const picker = await screen.findByTestId('address-select-button');

            await userEvent.click(picker);
            await userEvent.click(screen.getByTestId('add-new-address'));
            expect(screen.getByLabelText('First Name')).toBeVisible();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
            expect(setFreightActionsTarget).not.toHaveBeenCalled();

            const destination = {
                ...shippingAddress,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phone: '',
                stateOrProvince: '',
                stateOrProvinceCode: '',
            };

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithLoggedInCustomer,
                    consignments: [
                        {
                            ...consignment,
                            shippingAddress: destination,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            await checkout.fillAddressForm(destination);
            await waitFor(
                () =>
                    expect(setFreightActionsTarget).toHaveBeenLastCalledWith(
                        expect.any(HTMLDivElement),
                    ),
                { timeout: 4500 },
            );
            await userEvent.clear(screen.getByLabelText('Postal Code'));
            await waitFor(() => expect(setFreightActionsTarget).toHaveBeenLastCalledWith(null));
        });

        it('completes the shipping step as a guest and goes to the payment step by default', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await checkout.fillAddressForm();

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('shippingOptions-skeleton').length).toBe(0);
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('form-checklist-item--selected').length).toBe(
                1,
            );
            // eslint-disable-next-line jest-dom/prefer-to-have-attribute
            expect(
                screen
                    .getByLabelText('My billing address is the same as my shipping address.')
                    .hasAttribute('checked'),
            ).toBeTruthy();

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateBillingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: payments[0].config.displayName }),
            ).toBeInTheDocument();
        });

        it('completes the shipping step as a guest and goes to the billing step', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail);

            jest.spyOn(checkoutService, 'updateBillingAddress');

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await checkout.fillAddressForm();
            await userEvent.click(
                screen.getByLabelText('My billing address is the same as my shipping address.'),
            );
            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
            await checkout.waitForBillingStep();

            expect(checkoutService.updateBillingAddress).not.toHaveBeenCalled();
            // one `edit` button is for the cart, the other is for the shipping address.
            expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
            expect(screen.getByLabelText('First Name')).toBeInTheDocument();
        });

        it('completes the shipping step as a customer with no saved address and goes to the payment step by default', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithLoggedInCustomer);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await checkout.fillAddressForm();

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('shippingOptions-skeleton').length).toBe(0);
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('form-checklist-item--selected').length).toBe(
                1,
            );
            // eslint-disable-next-line jest-dom/prefer-to-have-attribute
            expect(
                screen
                    .getByLabelText('My billing address is the same as my shipping address.')
                    .hasAttribute('checked'),
            ).toBeTruthy();
            // eslint-disable-next-line jest-dom/prefer-to-have-attribute
            expect(
                screen
                    .getByLabelText('Save this address in my address book')
                    .hasAttribute('checked'),
            ).toBeTruthy();

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateBillingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: payments[0].config.displayName }),
            ).toBeInTheDocument();
        });

        it('selects the valid customer address and completes the shipping step', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            expect(screen.getByTestId('address-select-button')).toBeInTheDocument();
            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByText(/111 Testing Rd/i));

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('shippingOptions-skeleton').length).toBe(0);
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('form-checklist-item--selected').length).toBe(
                1,
            );
            // eslint-disable-next-line jest-dom/prefer-to-have-attribute
            expect(
                screen
                    .getByLabelText('My billing address is the same as my shipping address.')
                    .hasAttribute('checked'),
            ).toBeTruthy();

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateBillingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: payments[0].config.displayName }),
            ).toBeInTheDocument();
        });

        it('does not flag a saved customer address to be saved again when completing the shipping step', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByText(/111 Testing Rd/i));

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateShippingAddress).not.toHaveBeenCalledWith(
                expect.objectContaining({ shouldSaveAddress: true }),
            );
            expect(checkoutService.updateBillingAddress).toHaveBeenCalledWith(
                expect.objectContaining({ shouldSaveAddress: false }),
            );
        });

        it('enters new address for the customer with saved address and completes the shipping step', async () => {
            const config = {
                ...checkoutSettings,
                storeConfig: {
                    ...checkoutSettings.storeConfig,
                    checkoutSettings: {
                        ...checkoutSettings.storeConfig.checkoutSettings,
                        checkoutBillingSameAsShippingEnabled: false,
                    },
                },
            };

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart, {
                config,
            });

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            expect(screen.getByTestId('address-select-button')).toBeInTheDocument();
            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByTestId('add-new-address'));
            await checkout.fillAddressForm();

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('shippingOptions-skeleton').length).toBe(0);
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('form-checklist-item--selected').length).toBe(
                1,
            );

            expect(
                screen
                    .queryByLabelText('My billing address is the same as my shipping address.')
                    ?.hasAttribute('checked'),
            ).toBeFalsy();

            await userEvent.click(
                screen.getByLabelText('My billing address is the same as my shipping address.'),
            );
            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateBillingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: payments[0].config.displayName }),
            ).toBeInTheDocument();
        });

        it('selects the invalid customer address, fills the address form and finally completes the shipping step', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithCustomerHavingInvalidAddress);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithCustomerHavingInvalidAddress,
                    consignments: [],
                },
            );
            expect(screen.getByTestId('address-select-button')).toBeInTheDocument();
            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByText(/Fourth/i));

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            expect(await screen.findByLabelText('First Name')).toHaveDisplayValue('Fourth');
            expect(await screen.findByLabelText('Last Name')).toHaveDisplayValue('Address');
            expect(screen.getByText('Address is required')).toBeInTheDocument();
            expect(
                screen.getByLabelText('Save this address in my address book'),
            ).toBeInTheDocument();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithShipping,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await userEvent.type(
                screen.getByRole('textbox', { name: /address/i }),
                shippingAddress.address1,
            );

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();

            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('shippingOptions-skeleton').length).toBe(0);
            // eslint-disable-next-line testing-library/no-container,testing-library/no-node-access
            expect(container.getElementsByClassName('form-checklist-item--selected').length).toBe(
                1,
            );
            // eslint-disable-next-line jest-dom/prefer-to-have-attribute
            expect(
                screen
                    .getByLabelText('My billing address is the same as my shipping address.')
                    .hasAttribute('checked'),
            ).toBeTruthy();

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

            await checkout.waitForPaymentStep();

            expect(checkoutService.updateBillingAddress).toHaveBeenCalled();
            expect(
                screen.getByRole('radio', { name: payments[0].config.displayName }),
            ).toBeInTheDocument();
        });

        it('goes back to the shipping step as a guest and updates the shipping address form correctly', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithShippingAndBilling);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShippingAndBilling,
                },
            );

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForPaymentStep();

            await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);

            const randomAddress1 = {
                firstName: 'John',
                lastName: 'Smith',
                address1: '123 Test Street',
                city: 'Test City',
                countryCode: 'CC',
                stateOrProvince: 'dummy state',
                postalCode: '12345',
            };

            await checkout.fillAddressForm(randomAddress1);
            await userEvent.selectOptions(screen.getByTestId('field_60Input-select'), '2');

            expect(
                (checkoutService.updateShippingAddress as any).mock.calls.slice(-1)[0][0],
            ).toEqual(
                expect.objectContaining({
                    ...randomAddress1,
                    customFields: [{ fieldId: 'field_60', fieldValue: '2' }],
                }),
            );

            const randomAddress2 = {
                firstName: 'Jane',
                lastName: 'Doe',
                address1: '456 Sample Avenue',
                city: 'Melbourne',
                countryCode: 'AU',
                stateOrProvinceCode: 'VIC',
                postalCode: '3000',
            };

            await checkout.fillAddressForm(randomAddress2);
            await userEvent.selectOptions(screen.getByTestId('field_60Input-select'), '1');

            expect(
                (checkoutService.updateShippingAddress as any).mock.calls.slice(-1)[0][0],
            ).toEqual(
                expect.objectContaining({
                    ...randomAddress2,
                    customFields: [{ fieldId: 'field_60', fieldValue: '1' }],
                }),
            );
        });
    });

    it('renders and validates shipping form built-in and customfields', async () => {
        checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmailAndCustomFormFields);

        jest.spyOn(checkoutService, 'updateShippingAddress');
        jest.spyOn(checkoutService, 'updateBillingAddress');

        render(<CheckoutTest {...defaultProps} />);

        await checkout.waitForShippingStep();

        checkout.updateCheckout(
            'post',
            '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
            {
                ...checkoutWithBillingEmail,
                consignments: [
                    {
                        ...consignment,
                        selectedShippingOption: undefined,
                    },
                ],
            },
        );
        checkout.updateCheckout(
            'put',
            '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
            {
                ...checkoutWithShipping,
            },
        );
        checkout.updateCheckout(
            'put',
            '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/billing-address/billing-address-id*',
            {
                ...checkoutWithShippingAndBilling,
            },
        );

        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByText('First Name is required')).toBeInTheDocument();
        expect(screen.getByText('Last Name is required')).toBeInTheDocument();
        expect(screen.getByText('Address is required')).toBeInTheDocument();
        expect(screen.getByText('City is required')).toBeInTheDocument();
        expect(screen.getByText('Postal Code is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Text is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Date is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Number is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Checkbox is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Radio is required')).toBeInTheDocument();
        expect(screen.getByText('Custom Dropdown is required')).toBeInTheDocument();

        await checkout.fillAddressForm();
        await userEvent.type(screen.getByLabelText('Custom Text'), 'Custom Text');

        // jsdom implements Element.matches via nwsapi, whose matchesNative() falls back to
        // node.matches, so :modal recurses until the stack overflows and the error is
        // swallowed (~213ms per call). It is always false in jsdom, and @floating-ui probes
        // it on every element it positions while the datepicker calendar is open.
        const originalMatches = Element.prototype.matches;

        Object.defineProperty(Element.prototype, 'matches', {
            configurable: true,
            writable: true,
            value(this: Element, selectors: string): boolean {
                return selectors === ':modal' ? false : originalMatches.call(this, selectors);
            },
        });

        await userEvent.click(screen.getByPlaceholderText('DD/MM/YYYY'));
        await userEvent.type(screen.getByPlaceholderText('DD/MM/YYYY'), '01/01/2015');
        await userEvent.keyboard('{enter}');

        Object.defineProperty(Element.prototype, 'matches', {
            configurable: true,
            writable: true,
            value: originalMatches,
        });

        expect(screen.getByPlaceholderText('DD/MM/YYYY')).toHaveDisplayValue('01/01/2020');

        await userEvent.type(screen.getByLabelText('Custom Message'), 'Custom message text');
        await userEvent.type(screen.getByLabelText('Custom Number'), '123');

        expect(screen.getByText('Custom Number must be between 3 and 5')).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText('Custom Number'));
        await userEvent.type(screen.getByLabelText('Custom Number'), '2');

        expect(screen.getByText('Custom Number must be between 3 and 5')).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText('Custom Number'));
        await userEvent.type(screen.getByLabelText('Custom Number'), '3');

        await userEvent.type(screen.getByLabelText('Number with min validation (Optional)'), '2');

        expect(
            screen.getByText('Number with min validation must be greater than or equal to 5'),
        ).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText('Number with min validation (Optional)'));
        await userEvent.type(screen.getByLabelText('Number with min validation (Optional)'), '6');

        await userEvent.clear(screen.getByLabelText('Number with max validation (Optional)'));
        await userEvent.type(screen.getByLabelText('Number with max validation (Optional)'), '11');

        expect(
            screen.getByText('Number with max validation must be less than or equal to 10'),
        ).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText('Number with max validation (Optional)'));
        await userEvent.type(screen.getByLabelText('Number with max validation (Optional)'), '9');

        const customCheckbox = screen.getByText('Custom Checkbox');

        // eslint-disable-next-line testing-library/no-node-access, @typescript-eslint/no-non-null-assertion
        await userEvent.click(within(customCheckbox.parentElement!).getByLabelText('1'));
        // eslint-disable-next-line testing-library/no-node-access, @typescript-eslint/no-non-null-assertion
        await userEvent.click(within(customCheckbox.parentElement!).getByLabelText('2'));

        const customDropdown = screen.getByLabelText('Custom Dropdown');

        await userEvent.selectOptions(customDropdown, '1');

        const customRadio = screen.getByText('Custom Radio');

        // eslint-disable-next-line testing-library/no-node-access, @typescript-eslint/no-non-null-assertion
        await userEvent.click(within(customRadio.parentElement!).getByText('yes'));

        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
    });

    describe('Shipping options', () => {
        it('sees the quote failed message when no shipping option available', async () => {
            jest.mock('lodash', () => ({
                ...jest.requireActual('lodash'),
                debounce: (fn: any) => {
                    fn.cancel = jest.fn();

                    return fn;
                },
            }));

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'updateBillingAddress');

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            const checkoutMock = {
                ...checkoutWithBillingEmail,
                consignments: [
                    {
                        ...consignment,
                        selectedShippingOption: undefined,
                        availableShippingOptions: undefined,
                    },
                ],
            };

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                checkoutMock,
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                checkoutMock,
            );

            await checkout.fillAddressForm();

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();
            expect(screen.getByText(shippingQuoteFailedMessage)).toBeInTheDocument();
        });

        it('selects another shipping option', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail);

            jest.spyOn(checkoutService, 'updateShippingAddress');
            jest.spyOn(checkoutService, 'selectConsignmentShippingOption');

            const { container } = render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                checkoutWithShipping,
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await checkout.fillAddressForm();

            expect(checkoutService.updateShippingAddress).toHaveBeenCalled();

            expect(
                // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
                container.getElementsByClassName('form-checklist-item--selected')[0],
            ).toHaveTextContent('Pickup In Store$3.00');

            await userEvent.click(screen.getByRole('radio', { name: 'Flat Rate $10.00' }));

            expect(checkoutService.selectConsignmentShippingOption).toHaveBeenCalled();

            expect(
                // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
                container.getElementsByClassName('form-checklist-item--selected')[0],
            ).toHaveTextContent('Flat Rate$10.00');
        });

        it('displays strikethrough on shipping option when costAfterDiscount differs from cost', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail);

            jest.spyOn(checkoutService, 'updateShippingAddress');

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            checkout.updateCheckout(
                'post',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments',
                {
                    ...checkoutWithBillingEmail,
                    consignments: [
                        {
                            ...consignment,
                            selectedShippingOption: undefined,
                        },
                    ],
                },
            );
            checkout.updateCheckout(
                'put',
                '/checkouts/xxxxxxxxxx-xxxx-xxax-xxxx-xxxxxx/consignments/consignment-1',
                {
                    ...checkoutWithShipping,
                },
            );

            await checkout.fillAddressForm();

            expect(
                screen.getByRole('radio', { name: 'Pickup In Store $3.00' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Flat Rate $10.00' })).toBeInTheDocument();
            expect(
                screen.getByRole('radio', { name: 'Ship by Weight $30.00 $20.00' }),
            ).toBeInTheDocument();
        });
    });

    it('renders multi-shipping static consignments', async () => {
        checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart, {
            checkout: {
                ...checkoutWithMultiShippingCart,
                consignments: [
                    {
                        ...consignment,
                        lineItemIds: ['x', 'y'],
                    },
                    {
                        ...consignment,
                        id: 'consignment-2',
                        lineItemIds: ['z'],
                    },
                ],
            },
        });

        /*
        checkout.updateCheckout('get',
            '/checkout/*',
            {
                ...checkoutWithMultiShippingCart,
                consignments: [
                    {
                        ...consignment,
                        lineItemIds: ['x', 'y'],
                    },
                    {
                        ...consignment,
                        id: 'consignment-2',
                        lineItemIds: ['z'],
                    },
                ],
            }
        );
        */

        jest.spyOn(checkoutService, 'updateShippingAddress');
        jest.spyOn(checkoutService, 'updateBillingAddress');

        render(<CheckoutTest {...defaultProps} />);

        await checkout.waitForBillingStep();

        expect(screen.getByText('Destination #1')).toBeInTheDocument();
        expect(screen.getByText('Destination #2')).toBeInTheDocument();
    });

    describe('No countries available error handling', () => {
        it('calls onUnhandledError when no countries are available and experiment is enabled', async () => {
            const config = {
                ...checkoutSettings,
                storeConfig: {
                    ...checkoutSettings.storeConfig,
                    checkoutSettings: {
                        ...checkoutSettings.storeConfig.checkoutSettings,
                        features: {
                            'CHECKOUT-9630.no_countries_error_on_checkout': true,
                        },
                    },
                },
            };

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail, { config });

            jest.spyOn(checkoutService.getState().data, 'getShippingCountries').mockReturnValue([]);

            jest.spyOn(checkoutService, 'loadShippingAddressFields').mockResolvedValue(
                checkoutService.getState(),
            );
            jest.spyOn(checkoutService, 'loadShippingOptions').mockResolvedValue(
                checkoutService.getState(),
            );
            jest.spyOn(checkoutService, 'loadBillingAddressFields').mockResolvedValue(
                checkoutService.getState(),
            );

            jest.spyOn(defaultProps.errorLogger, 'log');
            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            await waitFor(() => {
                expect(defaultProps.errorLogger.log).toHaveBeenCalledWith(
                    expect.objectContaining({
                        name: 'no_countries_available',
                        type: 'custom',
                    }),
                );
            });
        });

        it('does not call onUnhandledError when no countries are available but experiment is disabled', async () => {
            const config = {
                ...checkoutSettings,
                storeConfig: {
                    ...checkoutSettings.storeConfig,
                    checkoutSettings: {
                        ...checkoutSettings.storeConfig.checkoutSettings,
                        features: {
                            'CHECKOUT-9630.no_countries_error_on_checkout': false,
                        },
                    },
                },
            };

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithBillingEmail, { config });

            // Mock getShippingCountries to return empty array
            jest.spyOn(checkoutService.getState().data, 'getShippingCountries').mockReturnValue([]);

            // Spy on errorLogger to verify error handling
            jest.spyOn(defaultProps.errorLogger, 'log');

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            // Verify that error was NOT logged when experiment is disabled
            expect(defaultProps.errorLogger.log).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'no_countries_available',
                    type: 'custom',
                }),
            );
        });
    });

    describe('restrictManualAddressEntry warning', () => {
        it('shows a warning when restrictManualAddressEntry is true and the customer has no saved addresses', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithLoggedInCustomer, {
                checkout: checkoutWithLoggedInCustomer,
            });

            const restrictManualAddressCapabilities = {
                ...defaultCapabilities,
                shipping: {
                    ...defaultCapabilities.shipping,
                    restrictManualAddressEntry: true,
                },
            };

            const CheckoutWithRestrictedAddressEntry: FunctionComponent<CheckoutProps> = (
                props,
            ) => (
                <CheckoutProvider checkoutService={checkoutService}>
                    <LocaleProvider
                        checkoutService={checkoutService}
                        languageService={getLanguageService()}
                    >
                        <AnalyticsProviderMock>
                            <ExtensionProvider extensionService={extensionService}>
                                <ThemeProvider>
                                    <CapabilitiesContext.Provider
                                        value={restrictManualAddressCapabilities}
                                    >
                                        <Checkout {...props} />
                                    </CapabilitiesContext.Provider>
                                </ThemeProvider>
                            </ExtensionProvider>
                        </AnalyticsProviderMock>
                    </LocaleProvider>
                </CheckoutProvider>
            );

            render(<CheckoutWithRestrictedAddressEntry {...defaultProps} />);

            expect(
                await screen.findByText(/no shipping address to choose from/i),
            ).toBeInTheDocument();
        });

        it('does not show the warning when restrictManualAddressEntry is false', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithLoggedInCustomer, {
                checkout: checkoutWithLoggedInCustomer,
            });

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            expect(
                screen.queryByText(/no shipping address to choose from/i),
            ).not.toBeInTheDocument();
        });
    });

    describe('B2B company address book', () => {
        const companyAddressBookCapabilities = {
            ...defaultCapabilities,
            userJourney: {
                ...defaultCapabilities.userJourney,
                hasCompanyAddressBook: true,
            },
        };

        const CheckoutWithCompanyAddressBook: FunctionComponent<CheckoutProps> = (props) => (
            <CheckoutProvider checkoutService={checkoutService}>
                <LocaleProvider
                    checkoutService={checkoutService}
                    languageService={getLanguageService()}
                >
                    <AnalyticsProviderMock>
                        <ExtensionProvider extensionService={extensionService}>
                            <ThemeProvider>
                                <CapabilitiesContext.Provider
                                    value={companyAddressBookCapabilities}
                                >
                                    <Checkout {...props} />
                                </CapabilitiesContext.Provider>
                            </ThemeProvider>
                        </ExtensionProvider>
                    </AnalyticsProviderMock>
                </LocaleProvider>
            </CheckoutProvider>
        );

        it('updates the shipping address when a company address is selected', async () => {
            // The searchable address book only lists addresses flagged for shipping.
            const checkoutWithCompanyShippingAddress = {
                ...checkoutWithMultiShippingCart,
                customer: {
                    ...customer,
                    addresses: [
                        {
                            ...shippingAddress,
                            id: 1,
                            ...getCustomerAddressB2B({ isShipping: true }),
                        },
                    ],
                },
            };

            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart, {
                checkout: checkoutWithCompanyShippingAddress,
            });

            const updateShippingAddressSpy = jest
                .spyOn(checkoutService, 'updateShippingAddress')
                .mockResolvedValue(checkoutService.getState());

            render(<CheckoutWithCompanyAddressBook {...defaultProps} />);

            await checkout.waitForShippingStep();

            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByTestId('address-select-option-action'));

            expect(updateShippingAddressSpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: 1 }),
            );
        });

        it('shows save address checkbox in multi-shipping new address modal when hasCompanyAddressBook is true', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            render(<CheckoutWithCompanyAddressBook {...defaultProps} />);

            await checkout.waitForShippingStep();

            await userEvent.click(screen.getByTestId('address-select-button'));
            await userEvent.click(screen.getByTestId('add-new-address'));

            expect(screen.getByLabelText('Save to company address book.')).toBeInTheDocument();
        });

        it('does not show save address checkbox in multi-shipping new address modal when hasCompanyAddressBook is false', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            render(<CheckoutTest {...defaultProps} />);

            await checkout.waitForShippingStep();

            await userEvent.click(screen.getByTestId('shipping-mode-toggle'));

            await userEvent.click(await screen.findByTestId('address-select-button'));
            await userEvent.click(screen.getByTestId('add-new-address'));

            const modal = await screen.findByRole('dialog');

            expect(
                within(modal).queryByLabelText('Save this address in my address book'),
            ).not.toBeInTheDocument();
        });

        it('does not call createCustomerAddress when hasCompanyAddressBook is true', async () => {
            checkoutService = checkout.use(CheckoutPreset.CheckoutWithMultiShippingCart);

            jest.spyOn(checkoutService, 'createCustomerAddress');

            render(<CheckoutWithCompanyAddressBook {...defaultProps} />);

            await checkout.waitForShippingStep();

            await userEvent.click(screen.getByTestId('shipping-mode-toggle'));

            await userEvent.click(await screen.findByTestId('address-select-button'));
            await userEvent.click(screen.getByTestId('add-new-address'));

            const modal = await screen.findByRole('dialog');

            await userEvent.clear(within(modal).getByLabelText('First Name'));
            await userEvent.type(within(modal).getByLabelText('First Name'), customer.firstName);
            await userEvent.clear(within(modal).getByLabelText('Last Name'));
            await userEvent.type(within(modal).getByLabelText('Last Name'), customer.lastName);
            await userEvent.clear(within(modal).getByTestId('addressLine1Input-text'));
            await userEvent.type(
                within(modal).getByTestId('addressLine1Input-text'),
                shippingAddress.address1,
            );
            await userEvent.click(within(modal).getByText('Save address'));

            await waitFor(() =>
                expect(checkoutService.createCustomerAddress).not.toHaveBeenCalled(),
            );
        });
    });
});
