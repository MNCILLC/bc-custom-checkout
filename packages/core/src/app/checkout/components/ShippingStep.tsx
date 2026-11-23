import type { AddressRequestBody, Cart, Consignment } from '@bigcommerce/checkout-sdk/essential';
import React, { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCheckout, useThemeContext } from '@bigcommerce/checkout/contexts';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { AddressFormSkeleton, LazyContainer } from '@bigcommerce/checkout/ui';

import { retry } from '../../common/utility';
import { ShopperCurrency } from '../../currency';
import { type ShippingProps, ShippingSummary } from '../../shipping';
import isWarehousePickup from '../../shipping/isWarehousePickup';
import { shouldShowMultiShippingToggle } from '../../shipping/utils';
import { getWarehouseCheckout } from '../../warehouse/config';
import {
    approveFreightPreferences,
    freightEndpoint,
    hasRestoredPickupReview,
    rememberPickupReview,
    saveFreightPreferences,
} from '../../warehouse/freight';
import FreightDelivery from '../../warehouse/FreightDelivery';
import { setShippingQuoteStatus } from '../../warehouse/shippingQuoteState';
import { warehouseSubmissionInProgress } from '../../warehouse/submissionState';
import { beginWarehouseTransition, validateCurrentWarehouse } from '../../warehouse/validation';
import { WarehouseFulfillmentOptions } from '../../warehouse/WarehouseFulfillmentOptions';
import { WarehouseShippingContext } from '../../warehouse/WarehouseShippingContext';
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
    const [transition, setTransition] = useState<'fulfillment' | 'preferences'>();
    const switching = transition !== undefined;
    const [switchError, setSwitchError] = useState('');
    const [freightReady, setFreightReady] = useState(!freightEndpoint());
    const [addressBusy, setAddressBusy] = useState(false);
    const [freightActionsTarget, setFreightActionsTarget] = useState<HTMLDivElement | null>(null);
    const reviewedCart = useRef<string>();
    const warehouse = getWarehouseCheckout()?.warehouse;
    const warehouseShipping = useMemo(
        () =>
            warehouse?.allowShipping
                ? {
                      freightReady: freightReady && !switching,
                      setAddressBusy,
                      setFreightActionsTarget,
                  }
                : undefined,
        [warehouse?.allowShipping, freightReady, switching],
    );
    const shippingFormRef = useCallback(
        (node: HTMLDivElement | null) => {
            node?.toggleAttribute('inert', switching);
        },
        [switching],
    );

    const matchingPickup =
        isPickup &&
        (!warehouse ||
            consignments[0].selectedPickupOption?.pickupMethodId === warehouse.pickupMethodId);

    const resumePickup = matchingPickup && hasRestoredPickupReview(consignments[0].id);

    // Native pickup may already be prepared by the authenticated storefront handoff.
    // Open delivery once so the shopper reviews preferences before payment.
    useEffect(() => {
        if (
            warehouse &&
            freightEndpoint() &&
            checkout &&
            step.isComplete &&
            step.isEditable &&
            reviewedCart.current !== checkout.id
        ) {
            reviewedCart.current = checkout.id;
            if (!resumePickup) onEdit(step.type);
        }
    }, [checkout, onEdit, resumePickup, step.isComplete, step.isEditable, step.type, warehouse]);

    const changeFulfillment = async (
        pickup: boolean,
        force = false,
        codes?: string[],
    ): Promise<boolean> => {
        if (
            !warehouse ||
            !cart ||
            !checkout ||
            switching ||
            addressBusy ||
            warehouseSubmissionInProgress() ||
            (!force && ((pickup && matchingPickup) || (!pickup && !isPickup)))
        ) {
            return false;
        }

        setTransition(isPickup !== pickup ? 'fulfillment' : 'preferences');
        setFreightReady(!freightEndpoint());
        setSwitchError('');
        setShippingQuoteStatus('loading');

        const endTransition = beginWarehouseTransition();

        try {
            await validateCurrentWarehouse(pickup ? 'pickup' : 'shipping');
            await saveFreightPreferences(pickup, codes);

            const cacheKey = `warehouse-preview-address:${checkout.id}`;
            const shipping = consignments.find((consignment) => !consignment.selectedPickupOption);

            if (shipping) {
                sessionStorage.setItem(cacheKey, JSON.stringify(shipping.shippingAddress));
            } else if (!isPickup) {
                sessionStorage.removeItem(cacheKey);
            }

            // Only a switch back from pickup should restore a previous shipping address.
            // An empty shipping consignment may mean the shopper chose "Enter a new address".
            const savedAddress = isPickup ? sessionStorage.getItem(cacheKey) : null;
            const shippingAddress =
                shipping?.shippingAddress ??
                (savedAddress ? (JSON.parse(savedAddress) as AddressRequestBody) : undefined);
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
            } else if (shippingAddress) {
                await checkoutService.createConsignments([
                    {
                        shippingAddress,
                        lineItems,
                    },
                ]);
            }

            await approveFreightPreferences();
            setFreightReady(true);

            return true;
        } catch (error) {
            setShippingQuoteStatus('failed');
            setSwitchError(
                error instanceof Error ? error.message : 'Unable to change fulfillment.',
            );

            try {
                await checkoutService.loadCheckout(checkout.id);
            } catch {
                // Keep the delivery step blocked if recovery also fails.
            }

            return false;
        } finally {
            endTransition();
            window.dispatchEvent(new Event('focus'));
            setTransition(undefined);
        }
    };

    const freightEditor = (
        <FreightDelivery
            busy={switching || addressBusy}
            onApply={(codes) =>
                changeFulfillment(isPickup || !warehouse?.allowShipping, true, codes)
            }
            onReady={() => setFreightReady(true)}
            onUnready={() => setFreightReady(false)}
            pickup={isPickup || !warehouse?.allowShipping}
            ready={freightReady}
            shippingActionsTarget={freightActionsTarget}
        />
    );

    useEffect(() => {
        if (isPickup || (warehouse && !warehouse.allowShipping)) {
            onReady?.();
        }
    }, [isPickup, onReady, warehouse]);

    if (!cart || !checkout || !config) {
        return null;
    }

    const shippingHeading = <TranslatedString id="shipping.shipping_heading" />;
    const heading = warehouse && !warehouse.allowShipping ? warehouse.pickupLabel : shippingHeading;
    const fulfillmentChoice = warehouse && (
        <>
            <WarehouseFulfillmentOptions
                busy={switching || addressBusy}
                onChange={changeFulfillment}
                pickup={isPickup}
                shippingPrice={
                    freightReady && consignments.some((item) => item.selectedShippingOption) ? (
                        <ShopperCurrency amount={checkout.shippingCostTotal} />
                    ) : undefined
                }
                warehouse={warehouse}
            />
            {switching && <p role="status">Updating fulfillment…</p>}
            {switchError && <p role="alert">{switchError}</p>}
        </>
    );

    if (
        warehouse &&
        ((!warehouse.allowShipping && !matchingPickup) || (isPickup && !matchingPickup))
    ) {
        return (
            <CheckoutStep {...step} heading={heading} onEdit={onEdit} onExpanded={onExpanded}>
                {fulfillmentChoice}
                <p>This order will be collected at your selected warehouse.</p>
                {freightEditor}
                {!freightEndpoint() && (
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
                )}
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
                heading={warehouse ? heading : 'Warehouse pickup'}
                onEdit={onEdit}
                onExpanded={onExpanded}
                summary={details}
            >
                {fulfillmentChoice}
                {details}
                {freightEditor}
                <button
                    className="button button--primary optimizedCheckout-buttonPrimary"
                    data-test="warehouse-pickup-continue"
                    disabled={switching || !freightReady}
                    onClick={() => {
                        rememberPickupReview(consignments[0].id);
                        navigateNextStep(false);
                    }}
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

    const shippingForm = (
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
    );

    return (
        <CheckoutStep
            {...step}
            headerAction={headerAction}
            heading={heading}
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
            {freightEditor}
            {warehouseShipping && transition !== 'fulfillment' ? (
                <WarehouseShippingContext.Provider value={warehouseShipping}>
                    <div className="warehouseShipping-address" ref={shippingFormRef}>
                        {shippingForm}
                    </div>
                </WarehouseShippingContext.Provider>
            ) : (
                !switching && freightReady && shippingForm
            )}
        </CheckoutStep>
    );
};

export default ShippingStep;
