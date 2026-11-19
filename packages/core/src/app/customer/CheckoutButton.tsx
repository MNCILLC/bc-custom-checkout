import {
    type CustomerInitializeOptions,
    type CustomerRequestOptions,
} from '@bigcommerce/checkout-sdk';
import React, { type ReactElement, useEffect } from 'react';

import { assertPaymentProviderAllowed } from '@bigcommerce/checkout/payment-integration-api';

const WALLET_BUTTON_HEIGHT = 40;

export interface CheckoutButtonProps {
    containerId: string;
    methodId: string;
    isShowingWalletButtonsOnTop?: boolean;
    deinitialize(options: CustomerRequestOptions): void;
    initialize(options: CustomerInitializeOptions): void;
    onError?(error: Error): void;
}

const CheckoutButton = ({
    containerId,
    methodId,
    isShowingWalletButtonsOnTop,
    deinitialize,
    initialize,
    onError,
}: CheckoutButtonProps): ReactElement => {
    useEffect(() => {
        try {
            assertPaymentProviderAllowed(methodId, 'express');
        } catch (error) {
            if (error instanceof Error) onError?.(error);

            return;
        }

        const heightOption =
            isShowingWalletButtonsOnTop &&
            (methodId === 'braintreepaypal' || methodId === 'braintreepaypalcredit')
                ? { buttonHeight: WALLET_BUTTON_HEIGHT }
                : {};

        initialize({
            methodId,
            [methodId]: {
                ...heightOption,
                container: containerId,
                onError,
                onClick: () => assertPaymentProviderAllowed(methodId, 'express'),
            },
        });

        return () => {
            deinitialize({ methodId });
        };
    }, []);

    return <div data-test={containerId} id={containerId} />;
};

export default CheckoutButton;
