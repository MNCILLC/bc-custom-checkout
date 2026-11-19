import {
    type AccountInstrument,
    type HostedInstrument,
    type BigCommercePaymentsPaymentInitializeOptions,
    type BigCommercePaymentsAlternativeMethodsPaymentInitializeOptions,
    type BigCommercePaymentsCreditCardsPaymentInitializeOptions,
    type BigCommercePaymentsVenmoPaymentInitializeOptions,
} from '@bigcommerce/checkout-sdk';
import {
    createBigCommercePaymentsPaymentStrategy,
    createBigCommercePaymentsAlternativeMethodsPaymentStrategy,
    createBigCommercePaymentsPayLaterPaymentStrategy,
    createBigCommercePaymentsVenmoPaymentStrategy,
    createBigCommercePaymentsRedirectAlternativeMethodsPaymentStrategy,
} from '@bigcommerce/checkout-sdk/integrations/bigcommerce-payments';
import React, { type FunctionComponent, useCallback, useEffect, useRef } from 'react';

import { InstrumentDeclinedError } from '@bigcommerce/checkout/error-handling-utils';
import {
    assertPaymentProviderAllowed,
    type PaymentMethodProps,
} from '@bigcommerce/checkout/payment-integration-api';

type BigCommercePaymentsProvidersPaymentInitializeOptions =
    BigCommercePaymentsAlternativeMethodsPaymentInitializeOptions &
        BigCommercePaymentsCreditCardsPaymentInitializeOptions &
        BigCommercePaymentsPaymentInitializeOptions &
        BigCommercePaymentsVenmoPaymentInitializeOptions;

interface BigCommercePaymentsPaymentMethodComponentProps {
    providerOptionsKey: string;
    providerOptionsData?: Partial<BigCommercePaymentsProvidersPaymentInitializeOptions>;
    currentInstrument?: AccountInstrument;
    shouldConfirmInstrument?: boolean;
}

interface ButtonActions {
    disable: () => void;
    enable: () => void;
}

const BigCommercePaymentsPaymentMethodComponent: FunctionComponent<
    PaymentMethodProps & BigCommercePaymentsPaymentMethodComponentProps
> = ({
    method,
    checkoutService,
    paymentForm,
    onUnhandledError,
    providerOptionsKey,
    providerOptionsData,
    children,
    currentInstrument,
    shouldConfirmInstrument,
}) => {
    const buttonActionsRef = useRef<ButtonActions | null>(null);
    const fieldsValuesRef = useRef<HostedInstrument | null>(null);
    const renderButtonRef = useRef<(() => void) | null>(null);
    const hasPayPalButton = useRef(false);

    const termsValue = paymentForm.getFieldValue('terms');
    const shouldSaveInstrument = paymentForm.getFieldValue('shouldSaveInstrument');

    const validateForm = async () => {
        const validationErrors = await paymentForm.validateForm();

        return Object.keys(validationErrors);
    };

    const validateButton = async () => {
        if (!buttonActionsRef.current) return;

        const keysValidation = await validateForm();

        if (keysValidation.length) {
            buttonActionsRef.current.disable();
        } else {
            buttonActionsRef.current.enable();
        }
    };

    const togglePaypalButton = useCallback(() => {
        if (currentInstrument && !shouldConfirmInstrument) {
            paymentForm.hidePaymentSubmitButton(method, false);
            hasPayPalButton.current = false;
        } else if (!hasPayPalButton.current && renderButtonRef.current) {
            paymentForm.hidePaymentSubmitButton(method, true);

            setTimeout(() => {
                renderButtonRef.current?.();

                hasPayPalButton.current = true;
            }, 0);
        }
    }, [currentInstrument]);

    useEffect(() => {
        togglePaypalButton();
    }, [togglePaypalButton, renderButtonRef.current]);

    useEffect(() => {
        void validateButton();
    }, [termsValue]);

    useEffect(() => {
        fieldsValuesRef.current = {
            shouldSaveInstrument: shouldConfirmInstrument || Boolean(shouldSaveInstrument),
        };
    }, [shouldSaveInstrument, shouldConfirmInstrument]);

    const providerAllowed = () => {
        try {
            assertPaymentProviderAllowed(method.id, 'payment');

            return true;
        } catch (error) {
            paymentForm.disableSubmit(method, true);
            if (error instanceof Error) onUnhandledError(error);

            return false;
        }
    };

    const initializePayment = async () => {
        try {
            assertPaymentProviderAllowed(method.id, 'payment');
            await checkoutService.initializePayment({
                gatewayId: method.gateway,
                methodId: method.id,
                integrations: [
                    createBigCommercePaymentsPaymentStrategy,
                    createBigCommercePaymentsAlternativeMethodsPaymentStrategy,
                    createBigCommercePaymentsPayLaterPaymentStrategy,
                    createBigCommercePaymentsVenmoPaymentStrategy,
                    createBigCommercePaymentsRedirectAlternativeMethodsPaymentStrategy,
                ],
                [providerOptionsKey]: {
                    container: '#checkout-payment-continue',
                    shouldRenderPayPalButtonOnInitialization: false,
                    onRenderButton: () => {
                        paymentForm.hidePaymentSubmitButton(method, true);
                    },
                    onInit: (onRenderButton: () => void) => {
                        renderButtonRef.current = () => {
                            if (providerAllowed()) onRenderButton();
                        };
                    },
                    submitForm: () => {
                        if (!providerAllowed()) return;
                        paymentForm.setSubmitted(true);
                        paymentForm.submitForm();
                    },
                    onError: (error: Error) => {
                        paymentForm.disableSubmit(method, true);

                        if (error.message === 'INSTRUMENT_DECLINED') {
                            onUnhandledError(new InstrumentDeclinedError());
                        } else {
                            onUnhandledError(error);
                        }
                    },
                    onValidate: async (resolve: () => void, reject: () => void): Promise<void> => {
                        if (!providerAllowed()) return reject();

                        const keysValidation = await validateForm();

                        if (keysValidation.length) {
                            paymentForm.setSubmitted(true);
                            keysValidation.forEach((key) => paymentForm.setFieldTouched(key));

                            return reject();
                        }

                        const isBillingAddressSaved =
                            await paymentForm.ensureBillingAddressSaved?.();

                        if (isBillingAddressSaved === false) {
                            paymentForm.setSubmitted(true);

                            return reject();
                        }

                        // Form/billing validation can yield; recheck the live policy before
                        // allowing the SDK to create a provider intent.
                        if (!providerAllowed()) return reject();

                        return resolve();
                    },
                    onInitButton: async (actions: ButtonActions) => {
                        buttonActionsRef.current = actions;
                        await validateButton();
                    },
                    getFieldsValues: () => fieldsValuesRef.current,
                    ...(providerOptionsData || {}),
                },
            });
        } catch (error) {
            if (error instanceof Error) {
                onUnhandledError(error);
            }
        }
    };

    const deinitializePayment = async () => {
        try {
            await checkoutService.deinitializePayment({
                gatewayId: method.gateway,
                methodId: method.id,
            });
        } catch (error) {
            if (error instanceof Error) {
                onUnhandledError(error);
            }
        }
    };

    useEffect(() => {
        void initializePayment();

        return () => {
            void deinitializePayment();
        };
    }, []);

    return children ? <>{children}</> : <></>;
};

export default BigCommercePaymentsPaymentMethodComponent;
