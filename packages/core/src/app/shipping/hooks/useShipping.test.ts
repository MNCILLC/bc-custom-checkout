import type { CheckoutService } from '@bigcommerce/checkout-sdk/essential';
import { renderHook } from '@testing-library/react';

import * as contexts from '@bigcommerce/checkout/contexts';
import { defaultCapabilities } from '@bigcommerce/checkout/contexts';
import { PaymentMethodId } from '@bigcommerce/checkout/payment-integration-api';
import {
    getCart,
    getCheckout,
    getConsignment,
    getCustomer,
    getShippingAddress,
    getStoreConfig,
} from '@bigcommerce/checkout/test-mocks';

import { getAddressFormFields } from '../../address/formField.mock';
import { getBillingAddress } from '../../billing/billingAddresses.mock';
import { getCountries } from '../../geography/countries.mock';
import { backgroundWarehouseChecks } from '../../warehouse/submissionState';

import { useShipping } from './useShipping';

describe('useShipping', () => {
    const checkoutService = {
        assignItemsToAddress: jest.fn(),
        createCustomerAddress: jest.fn(),
        deinitializeShipping: jest.fn(),
        deleteConsignment: jest.fn(),
        initializeShipping: jest.fn(),
        loadShippingAddressFields: jest.fn(),
        loadBillingAddressFields: jest.fn(),
        loadShippingOptions: jest.fn(),
        signOutCustomer: jest.fn(),
        unassignItemsToAddress: jest.fn(),
        updateBillingAddress: jest.fn(),
        updateCheckout: jest.fn(),
        updateShippingAddress: jest.fn(),
    };
    const checkoutState = {
        data: {
            getCart,
            getCheckout,
            getConfig: getStoreConfig,
            getCustomer,
            getConsignments: () => [getConsignment()],
            getShippingAddress,
            getBillingAddress,
            getShippingAddressFields: getAddressFormFields,
            getShippingCountries: getCountries,
            getAddressExtraFields: jest.fn().mockReturnValue([]),
        },
        statuses: {
            isShippingStepPending: () => false,
            isSelectingShippingOption: () => false,
            isLoadingShippingOptions: () => false,
            isUpdatingConsignment: () => false,
            isCreatingConsignments: () => false,
            isCreatingCustomerAddress: () => false,
            isLoadingShippingCountries: () => false,
            isUpdatingBillingAddress: () => false,
            isUpdatingCheckout: () => false,
            isDeletingConsignment: () => false,
            isLoadingCheckout: () => false,
        },
    };

    beforeEach(() => {
        jest.spyOn(contexts, 'useCheckout').mockReturnValue({
            checkoutState,
            checkoutService,
        } as any);
        jest.spyOn(contexts, 'useCapabilities').mockReturnValue(defaultCapabilities);
        jest.spyOn(checkoutState.data, 'getCheckout').mockReturnValue({
            id: 'checkout',
            customerMessage: 'msg',
        } as any);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns all expected values from the hook', () => {
        const { result } = renderHook(() => useShipping());

        expect(result.current.cart).toEqual(getCart());
        expect(result.current.customer).toEqual(getCustomer());
        expect(result.current.shouldShowOrderComments).toBe(true);
        expect(result.current.shouldShowMultiShipping).toBe(false);
    });

    it('keeps shipping usable during a warehouse refresh and busy during shipping changes', () => {
        const service = checkoutService as unknown as CheckoutService;

        jest.spyOn(checkoutState.statuses, 'isLoadingCheckout').mockReturnValue(true);

        const { result, rerender } = renderHook(() => useShipping());

        expect(result.current.isLoading).toBe(true);
        backgroundWarehouseChecks.set(service, Promise.resolve());

        try {
            rerender();
            expect(result.current.isLoading).toBe(false);
            jest.spyOn(checkoutState.statuses, 'isUpdatingConsignment').mockReturnValue(true);
            rerender();
            expect(result.current.isLoading).toBe(true);
        } finally {
            backgroundWarehouseChecks.delete(service);
        }
    });

    describe('shouldShowMultiShipping', () => {
        beforeEach(() => {
            jest.spyOn(checkoutState.data, 'getCart').mockReturnValue({
                ...getCart(),
                lineItems: {
                    ...getCart().lineItems,
                    physicalItems: [
                        {
                            ...getCart().lineItems.physicalItems[0],
                            quantity: 2,
                        },
                    ],
                },
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('is false if hasMultiShippingEnabled is false', () => {
            jest.spyOn(checkoutState.data, 'getConfig').mockReturnValue({
                ...getStoreConfig(),
                checkoutSettings: {
                    ...getStoreConfig().checkoutSettings,
                    enableOrderComments: true,
                    hasMultiShippingEnabled: false,
                    providerWithCustomCheckout: null,
                },
            });

            const { result } = renderHook(() => useShipping());

            expect(result.current.shouldShowMultiShipping).toBe(false);
        });

        it('is true if hasMultiShippingEnabled is true and providerWithCustomCheckout is undefined', () => {
            jest.spyOn(checkoutState.data, 'getConfig').mockReturnValue({
                ...getStoreConfig(),
                checkoutSettings: {
                    ...getStoreConfig().checkoutSettings,
                    enableOrderComments: true,
                    hasMultiShippingEnabled: true,
                    providerWithCustomCheckout: null,
                },
            });

            const { result } = renderHook(() => useShipping());

            expect(result.current.shouldShowMultiShipping).toBe(true);
        });

        it('is false when remote shipping is enabled', () => {
            jest.spyOn(checkoutState.data, 'getConfig').mockReturnValue({
                ...getStoreConfig(),
                checkoutSettings: {
                    ...getStoreConfig().checkoutSettings,
                    enableOrderComments: true,
                    hasMultiShippingEnabled: true,
                    providerWithCustomCheckout: null,
                },
            });

            jest.spyOn(checkoutState.data, 'getCheckout').mockReturnValue({
                ...getCheckout(),
                payments: [{ providerId: 'amazonpay' }],
            } as any);

            const { result } = renderHook(() => useShipping());

            expect(result.current.shouldShowMultiShipping).toBe(false);
        });
    });

    describe('getFields', () => {
        const extraFields = [
            {
                custom: false,
                default: '',
                id: 'b2bExtraField_100',
                label: 'Company Name',
                name: 'b2bExtraField_100',
                required: false,
            },
        ];

        it('returns system fields combined with extra fields when hasAddressExtraFields is true', () => {
            jest.spyOn(contexts, 'useCapabilities').mockReturnValue({
                ...defaultCapabilities,
                userJourney: { ...defaultCapabilities.userJourney, hasAddressExtraFields: true },
            });
            checkoutState.data.getAddressExtraFields.mockReturnValue(extraFields);

            const { result } = renderHook(() => useShipping());
            const fields = result.current.getFields('US');

            const addressFormFields = getAddressFormFields();

            expect(fields.length).toBe(addressFormFields.length + extraFields.length);
            expect(fields[fields.length - 1].name).toBe('b2bExtraField_100');
        });

        it('returns only system fields when hasAddressExtraFields is false even if extra fields exist', () => {
            jest.spyOn(contexts, 'useCapabilities').mockReturnValue({
                ...defaultCapabilities,
                userJourney: { ...defaultCapabilities.userJourney, hasAddressExtraFields: false },
            });
            checkoutState.data.getAddressExtraFields.mockReturnValue(extraFields);

            const { result } = renderHook(() => useShipping());
            const fields = result.current.getFields('US');

            expect(fields.length).toBe(getAddressFormFields().length);
        });

        it('returns only system fields when no extra fields exist', () => {
            jest.spyOn(contexts, 'useCapabilities').mockReturnValue({
                ...defaultCapabilities,
                userJourney: { ...defaultCapabilities.userJourney, hasAddressExtraFields: true },
            });
            checkoutState.data.getAddressExtraFields.mockReturnValue([]);

            const { result } = renderHook(() => useShipping());
            const fields = result.current.getFields('US');

            expect(fields.length).toBe(getAddressFormFields().length);
        });
    });

    describe('shippingAddress', () => {
        const customerExtraFields = [{ fieldId: '100', fieldValue: 'Acme Corp' }];

        it('returns the shippingAddress from checkout state, including its extraFields', () => {
            jest.spyOn(checkoutState.data, 'getShippingAddress').mockReturnValue({
                ...getShippingAddress(),
                extraFields: customerExtraFields,
            });

            const { result } = renderHook(() => useShipping());

            expect(result.current.shippingAddress?.extraFields).toEqual(customerExtraFields);
        });

        it('does not graft extraFields from the customer address book', () => {
            jest.spyOn(checkoutState.data, 'getShippingAddress').mockReturnValue(
                getShippingAddress(),
            );
            jest.spyOn(checkoutState.data, 'getCustomer').mockReturnValue({
                ...getCustomer(),
                addresses: [
                    {
                        ...getShippingAddress(),
                        id: 5,
                        type: 'residential',
                        extraFields: customerExtraFields,
                    },
                ],
            });

            const { result } = renderHook(() => useShipping());

            expect(result.current.shippingAddress?.extraFields).toBeUndefined();
        });
    });

    it('shouldRenderStripeForm is true if providerWithCustomCheckout is StripeUPE and shouldUseStripeLinkByMinimumAmount returns true', () => {
        jest.mock('@bigcommerce/checkout/instrument-utils', () => ({
            ...jest.requireActual('@bigcommerce/checkout/instrument-utils'),
            shouldUseStripeLinkByMinimumAmount: jest.fn().mockResolvedValue(true),
        }));
        jest.spyOn(checkoutState.data, 'getConfig').mockReturnValue({
            ...getStoreConfig(),
            checkoutSettings: {
                ...getStoreConfig().checkoutSettings,
                enableOrderComments: true,
                hasMultiShippingEnabled: true,
                providerWithCustomCheckout: PaymentMethodId.StripeUPE,
            },
        });

        const { result } = renderHook(() => useShipping());

        expect(result.current.shouldRenderStripeForm).toBe(true);
    });
});
