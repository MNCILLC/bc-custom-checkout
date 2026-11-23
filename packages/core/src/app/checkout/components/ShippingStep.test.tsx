import { screen, waitFor } from '@testing-library/react';
import React from 'react';

import * as contexts from '@bigcommerce/checkout/contexts';
import {
    getCart,
    getCheckout,
    getConsignment,
    getStoreConfig,
} from '@bigcommerce/checkout/test-mocks';
import { render } from '@bigcommerce/checkout/test-utils';

import * as warehouseConfig from '../../warehouse/config';
import * as freight from '../../warehouse/freight';
import CheckoutStepType from '../CheckoutStepType';

import ShippingStep, { type ShippingStepProps } from './ShippingStep';

jest.mock('../../shipping/Shipping', () => ({
    __esModule: true,
    default: () => <div data-test="shipping" />,
}));

jest.mock('../../warehouse/FreightDelivery', () => ({ __esModule: true, default: () => <div /> }));

describe('ShippingStep', () => {
    const defaultProps: ShippingStepProps = {
        step: {
            isActive: true,
            isBusy: false,
            isComplete: false,
            isEditable: false,
            isRequired: true,
            type: CheckoutStepType.Shipping,
        },
        cart: getCart(),
        consignments: [],
        cartHasChanged: false,
        isBillingSameAsShipping: true,
        isMultiShippingMode: false,
        navigateNextStep: jest.fn(),
        onCreateAccount: jest.fn(),
        onEdit: jest.fn(),
        onExpanded: jest.fn(),
        onSignIn: jest.fn(),
        onToggleMultiShipping: jest.fn(),
        onUnhandledError: jest.fn(),
        setIsMultishippingMode: jest.fn(),
    };

    const mockCheckoutState = (selectedState: { checkout?: unknown; config?: unknown }) => {
        jest.spyOn(contexts, 'useCheckout').mockReturnValue({
            selectedState,
        } as unknown as ReturnType<typeof contexts.useCheckout>);
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        ['cart', { checkout: getCheckout(), config: getStoreConfig() }, { cart: undefined }],
        ['checkout', { config: getStoreConfig() }, {}],
        ['config', { checkout: getCheckout() }, {}],
    ])('renders nothing when %s is missing from state', (_name, selectedState, propOverrides) => {
        mockCheckoutState(selectedState);

        const { container } = render(<ShippingStep {...defaultProps} {...propOverrides} />);

        expect(container).toBeEmptyDOMElement();
    });
    it('opens delivery review once for an already prepared native checkout', async () => {
        const onEdit = jest.fn();

        jest.spyOn(freight, 'freightEndpoint').mockReturnValue('https://backend.invalid/freight');
        jest.spyOn(warehouseConfig, 'getWarehouseCheckout').mockReturnValue({
            warehouse: { allowShipping: true, label: 'Origin', pickupLabel: 'Origin pickup' },
        } as warehouseConfig.WarehouseCheckoutConfig);
        mockCheckoutState({ checkout: getCheckout(), config: getStoreConfig() });

        const props = {
            ...defaultProps,
            onEdit,
            step: { ...defaultProps.step, isActive: false, isComplete: true, isEditable: true },
        };
        const view = render(<ShippingStep {...props} />);

        await waitFor(() => expect(onEdit).toHaveBeenCalledWith(CheckoutStepType.Shipping));
        view.rerender(<ShippingStep {...props} />);
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('shows Pickup first with its location and displays the shipping price once a quote is selected', () => {
        jest.spyOn(warehouseConfig, 'getWarehouseCheckout').mockReturnValue({
            warehouse: {
                allowShipping: true,
                pickupMethodId: 3,
                pickupLabel: 'Pickup from Forney, TX',
            },
        } as warehouseConfig.WarehouseCheckoutConfig);
        mockCheckoutState({ checkout: getCheckout(), config: getStoreConfig() });

        const view = render(<ShippingStep {...defaultProps} />);

        expect(screen.getAllByRole('radio')[0]).toHaveAccessibleName(
            'Pickup at Warehouse Forney, TX',
        );
        expect(screen.getByRole('radio', { name: 'Ship' })).toBeChecked();
        view.rerender(<ShippingStep {...defaultProps} consignments={[getConsignment()]} />);
        expect(screen.getByRole('radio', { name: 'Ship $16.80' })).toBeChecked();
        view.rerender(
            <ShippingStep
                {...defaultProps}
                consignments={[
                    { ...getConsignment(), selectedPickupOption: { pickupMethodId: 3 } },
                ]}
            />,
        );
        expect(screen.getByRole('radio', { name: /Pickup at Warehouse/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Ship' })).not.toBeChecked();
    });

    it('shows only the selected Pickup option for a pickup-only warehouse', () => {
        jest.spyOn(warehouseConfig, 'getWarehouseCheckout').mockReturnValue({
            warehouse: {
                allowShipping: false,
                pickupMethodId: 7,
                pickupLabel: 'Pickup in Powell, WY',
            },
        } as warehouseConfig.WarehouseCheckoutConfig);
        mockCheckoutState({ checkout: getCheckout(), config: getStoreConfig() });
        render(
            <ShippingStep
                {...defaultProps}
                consignments={[
                    { ...getConsignment(), selectedPickupOption: { pickupMethodId: 7 } },
                ]}
            />,
        );

        expect(screen.getByRole('radio', { name: 'Pickup at Warehouse Powell, WY' })).toBeChecked();
        expect(screen.queryByRole('radio', { name: /^Ship\b/ })).not.toBeInTheDocument();
    });
});
