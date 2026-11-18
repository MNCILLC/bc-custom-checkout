import type { AddressRequestBody, Cart, Consignment } from '@bigcommerce/checkout-sdk/essential';
import React, { lazy, useEffect, useState } from 'react';

import { useCheckout, useThemeContext } from '@bigcommerce/checkout/contexts';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { AddressFormSkeleton, LazyContainer } from '@bigcommerce/checkout/ui';

import { retry } from '../../common/utility';
import { type ShippingProps, ShippingSummary } from '../../shipping';
import isWarehousePickup from '../../shipping/isWarehousePickup';
import { shouldShowMultiShippingToggle } from '../../shipping/utils';
import { getWarehouseCheckout } from '../../warehouse/config';
import { warehouseSubmissionInProgress } from '../../warehouse/submissionState';
import { beginWarehouseTransition, validateCurrentWarehouse } from '../../warehouse/validation';
import CheckoutStep from '../CheckoutStep';
import type CheckoutStepType from '../CheckoutStepType';

const Shipping = lazy(() =>
    retry(
        () =>
            import(
                /* webpackChunkName: "shipping" */
                '../../shipping/Shipping'
            ),
    ),
);

export interface ShippingStepProps extends ShippingProps {
    cart?: Cart;
    consignments: Consignment[];
    onEdit(type: CheckoutStepType): void;
    onExpanded(type: CheckoutStepType): void;
}

const ShippingStep: React.FC<ShippingStepProps> = ({
    step,
    cartHasChanged,
    cart,
    consignments,
    isBillingSameAsShipping,
    isMultiShippingMode,
    onEdit,
    onExpanded,
    navigateNextStep,
    onCreateAccount,
    onReady,
    onSignIn,
    onToggleMultiShipping,
    onUnhandledError,
    setIsMultishippingMode,
}) => {
    const { enhancedThemeV1 } = useThemeContext();
    const {
        checkoutService,
        selectedState: { checkout, config },
    } = useCheckout(({ data }) => ({
        checkout: data.getCheckout(),
        config: data.getConfig(),
    }));

    const isPickup = isWarehousePickup(consignments);
    const [switching, setSwitching] = useState(false);
    const [switchError, setSwitchError] = useState('');
    const warehouse = getWarehouseCheckout()?.warehouse;
    const matchingPickup =
        isPickup &&
        (!warehouse ||
            consignments[0].selectedPickupOption?.pickupMethodId === warehouse.pickupMethodId);

    const changeFulfillment = async (pickup: boolean) => {
        if (
            !warehouse ||
            !cart ||
            !checkout ||
            switching ||
            warehouseSubmissionInProgress() ||
            (pickup && matchingPickup) ||
            (!pickup && !isPickup)
        ) {
            return;
        }

        setSwitching(true);
        setSwitchError('');

        const endTransition = beginWarehouseTransition();

        try {
            await validateCurrentWarehouse(pickup ? 'pickup' : 'shipping');

            const cacheKey = `warehouse-preview-address:${checkout.id}`;
            const shipping = consignments.find((consignment) => !consignment.selectedPickupOption);

            if (shipping) {
                sessionStorage.setItem(cacheKey, JSON.stringify(shipping.shippingAddress));
            }

            const savedAddress = sessionStorage.getItem(cacheKey);
            const lineItems = cart.lineItems.physicalItems.map((item) => ({
                itemId: item.id,
                quantity: item.quantity,
            }));

            // Replacement is deliberate: never keep shipping and pickup for the same item.
            for (const consignment of consignments) {
                // Consignment replacement must be sequential.
                // eslint-disable-next-line no-await-in-loop
                await checkoutService.deleteConsignment(consignment.id);
            }

            if (pickup) {
                await checkoutService.createConsignments([
                    {
                        pickupOption: { pickupMethodId: warehouse.pickupMethodId },
                        lineItems,
                    },
                ]);
            } else if (savedAddress) {
                await checkoutService.createConsignments([
                    {
                        shippingAddress: JSON.parse(savedAddress) as AddressRequestBody,
                        lineItems,
                    },
                ]);
            }
        } catch (error) {
            setSwitchError(
                error instanceof Error ? error.message : 'Unable to change fulfillment.',
            );
            await checkoutService.loadCheckout(checkout.id);
        } finally {
            endTransition();
            window.dispatchEvent(new Event('focus'));
            setSwitching(false);
        }
    };

    const fulfillmentChoice = warehouse?.allowShipping ? (
        <fieldset
            className="form-fieldset"
            data-test="warehouse-fulfillment-choice"
            disabled={switching}
        >
            <legend className="form-legend">How would you like to receive your order?</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <button
                    aria-pressed={!isPickup}
                    className="button optimizedCheckout-buttonSecondary"
                    data-test="warehouse-ship"
                    onClick={() => {
                        changeFulfillment(false);
                    }}
                    type="button"
                >
                    Ship to me
                </button>
                <button
                    aria-pressed={isPickup}
                    className="button optimizedCheckout-buttonSecondary"
                    data-test="warehouse-pickup"
                    onClick={() => {
                        changeFulfillment(true);
                    }}
                    type="button"
                >
                    {warehouse.pickupLabel}
                </button>
            </div>
            {switching && <p role="status">Updating fulfillment…</p>}
            {switchError && <p role="alert">{switchError}</p>}
        </fieldset>
    ) : null;

    useEffect(() => {
        if (isPickup || (warehouse && !warehouse.allowShipping)) {
            onReady?.();
        }
    }, [isPickup, onReady, warehouse]);

    if (!cart || !checkout || !config) {
        return null;
    }

    if (
        warehouse &&
        ((!warehouse.allowShipping && !matchingPickup) || (isPickup && !matchingPickup))
    ) {
        return (
            <CheckoutStep
                {...step}
                heading={warehouse.pickupLabel}
                onEdit={onEdit}
                onExpanded={onExpanded}
            >
                <p>This order will be collected at your selected warehouse.</p>
                {switchError && <p role="alert">{switchError}</p>}
                <button
                    className="button button--primary optimizedCheckout-buttonPrimary"
                    data-test="warehouse-prepare-pickup"
                    disabled={switching}
                    onClick={() => {
                        changeFulfillment(true);
                    }}
                    type="button"
                >
                    {switching ? 'Preparing pickup…' : `Confirm ${warehouse.pickupLabel}`}
                </button>
            </CheckoutStep>
        );
    }

    if (matchingPickup) {
        const address = consignments[0].shippingAddress;

        const details = (
            <div className="body-regular" data-test="warehouse-pickup-summary">
                <strong>{warehouse?.pickupLabel ?? 'Warehouse pickup'}</strong>
                <div>{address.address1}</div>
                <div>
                    {address.city}, {address.stateOrProvinceCode} {address.postalCode}
                </div>
            </div>
        );

        return (
            <CheckoutStep
                {...step}
                heading={warehouse?.pickupLabel ?? 'Warehouse pickup'}
                onEdit={onEdit}
                onExpanded={onExpanded}
                summary={details}
            >
                {fulfillmentChoice}
                {details}
                <button
                    className="button button--primary optimizedCheckout-buttonPrimary"
                    data-test="warehouse-pickup-continue"
                    disabled={switching}
                    onClick={() => navigateNextStep(false)}
                    type="button"
                >
                    Continue to payment
                </button>
            </CheckoutStep>
        );
    }

    const shouldShowHeaderAction =
        !warehouse &&
        enhancedThemeV1 &&
        checkout &&
        config &&
        shouldShowMultiShippingToggle(checkout, config, cart);

    const headerAction = shouldShowHeaderAction ? (
        <span className="body-cta" data-test="shipping-mode-toggle">
            <TranslatedString
                id={isMultiShippingMode ? 'shipping.ship_to_single' : 'shipping.ship_to_multi'}
            />
        </span>
    ) : null;

    return (
        <CheckoutStep
            {...step}
            headerAction={headerAction}
            heading={
                warehouse ? warehouse.label : <TranslatedString id="shipping.shipping_heading" />
            }
            key={step.type}
            onEdit={onEdit}
            onExpanded={onExpanded}
            summary={
                <ShippingSummary
                    cart={cart}
                    consignments={consignments}
                    isMultiShippingMode={isMultiShippingMode}
                />
            }
        >
            {fulfillmentChoice}
            {!switching && (
                <LazyContainer loadingSkeleton={<AddressFormSkeleton />}>
                    <Shipping
                        cartHasChanged={cartHasChanged}
                        isBillingSameAsShipping={isBillingSameAsShipping}
                        isMultiShippingMode={isMultiShippingMode}
                        navigateNextStep={navigateNextStep}
                        onCreateAccount={onCreateAccount}
                        onReady={onReady}
                        onSignIn={onSignIn}
                        onToggleMultiShipping={onToggleMultiShipping}
                        onUnhandledError={onUnhandledError}
                        setIsMultishippingMode={setIsMultishippingMode}
                        step={step}
                    />
                </LazyContainer>
            )}
        </CheckoutStep>
    );
};

export default ShippingStep;
