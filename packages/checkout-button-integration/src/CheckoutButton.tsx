import React, { type FunctionComponent, useEffect } from 'react';

import {
    assertPaymentProviderAllowed,
    type CheckoutButtonProps,
    type CheckoutButtonResolveId,
    toResolvableComponent,
} from '@bigcommerce/checkout/payment-integration-api';

function isClickCallback(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function';
}

const CheckoutButton: FunctionComponent<CheckoutButtonProps> = ({
    checkoutService: { deinitializeCustomer, initializeCustomer },
    checkoutButtonContainerClass,
    containerId,
    methodId,
    onUnhandledError,
    additionalInitializationOptions,
    integrations,
}) => {
    const initializeCustomerStrategyOrThrow = async () => {
        try {
            assertPaymentProviderAllowed(methodId, 'express');
            await initializeCustomer({
                methodId,
                integrations,
                [methodId]: {
                    container: containerId,
                    onUnhandledError,
                    ...additionalInitializationOptions,
                    onClick: (...args: unknown[]) => {
                        assertPaymentProviderAllowed(methodId, 'express');

                        const onClick = additionalInitializationOptions?.onClick;

                        if (isClickCallback(onClick)) return onClick(...args);
                    },
                },
            });
        } catch (error) {
            if (typeof onUnhandledError === 'function' && error instanceof Error) {
                onUnhandledError(error);
            }
        }
    };

    const deinitializeCustomerStrategyOrThrow = async () => {
        try {
            await deinitializeCustomer({ methodId });
        } catch (error) {
            if (typeof onUnhandledError === 'function' && error instanceof Error) {
                onUnhandledError(error);
            }
        }
    };

    useEffect(() => {
        void initializeCustomerStrategyOrThrow();

        return () => {
            void deinitializeCustomerStrategyOrThrow();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={checkoutButtonContainerClass} data-test={containerId} id={containerId} />
    );
};

export default toResolvableComponent<CheckoutButtonProps, CheckoutButtonResolveId>(
    CheckoutButton,
    [],
);
