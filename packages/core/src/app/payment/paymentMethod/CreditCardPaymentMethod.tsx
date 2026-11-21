import {
    type CardInstrument,
    type CheckoutSelectors,
    type HostedFieldType,
    type Instrument,
    type PaymentInitializeOptions,
    type PaymentInstrument,
    type PaymentMethod,
    type PaymentRequestOptions,
} from '@bigcommerce/checkout-sdk';
import { createLegacyPaymentStrategy } from '@bigcommerce/checkout-sdk/integrations/legacy';
import { memoizeOne } from '@bigcommerce/memoize';
import { find, noop } from 'lodash';
import React, { Component, Fragment, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { type ObjectSchema } from 'yup';

import { type CheckoutContextProps } from '@bigcommerce/checkout/contexts';
import { type MapToPropsFactory } from '@bigcommerce/checkout/legacy-hoc';
import { withLanguage, type WithLanguageProps } from '@bigcommerce/checkout/locale';
import { type PaymentFormValues } from '@bigcommerce/checkout/payment-integration-api';
import { LoadingOverlay } from '@bigcommerce/checkout/ui';

import { withCheckout } from '../../checkout';
import { isErrorWithType } from '../../common/error';
import { connectFormik, type ConnectFormikProps } from '../../common/form';
import {
    configureCardValidator,
    CreditCardFieldset,
    getCreditCardValidationSchema,
} from '../creditCard';
import {
    CardInstrumentFieldset,
    type CardInstrumentFieldsetValues,
    CreditCardValidation,
    getInstrumentValidationSchema,
    isCardInstrument,
    isInstrumentCardCodeRequiredSelector,
    isInstrumentCardNumberRequiredSelector,
    isInstrumentFeatureAvailable,
} from '../storedInstrument';
import StoreInstrumentFieldset from '../StoreInstrumentFieldset';
import withForm, { type WithFormProps } from '../withForm';
import withPayment, { type WithPaymentProps } from '../withPayment';

import type CreditCardFieldsetValues from './CreditCardFieldsetValues';

export interface CreditCardPaymentMethodProps {
    isInitializing?: boolean;
    isUsingMultiShipping?: boolean;
    method: PaymentMethod;
    cardFieldset?: ReactNode;
    cardValidationSchema?: ObjectSchema;
    storedCardValidationSchema?: ObjectSchema;
    deinitializePayment(options: PaymentRequestOptions): Promise<CheckoutSelectors>;
    getStoredCardValidationFieldset?(selectedInstrument?: CardInstrument): ReactNode;
    initializePayment(
        options: PaymentInitializeOptions,
        selectedInstrument?: CardInstrument,
    ): Promise<CheckoutSelectors>;
    onUnhandledError?(error: Error): void;
}

export type CreditCardPaymentMethodValues = CreditCardFieldsetValues | CardInstrumentFieldsetValues;

interface WithCheckoutCreditCardPaymentMethodProps {
    instruments: CardInstrument[];
    isCardCodeRequired: boolean;
    isCustomerCodeRequired: boolean;
    isInstrumentFeatureAvailable: boolean;
    isLoadingInstruments: boolean;
    isPaymentDataRequired: boolean;
    shouldShowInstrumentFieldset: boolean;
    isInstrumentCardCodeRequired(instrument: Instrument, method: PaymentMethod): boolean;
    isInstrumentCardNumberRequired(instrument: Instrument): boolean;
    loadInstruments(): Promise<CheckoutSelectors>;
}

interface CreditCardPaymentMethodState {
    hostedFieldsetKey: number;
    focusedHostedFieldType?: HostedFieldType;
    isAddingNewCard: boolean;
    selectedInstrumentId?: string;
    isPreloaderOn: boolean;
}

class CreditCardPaymentMethod extends Component<
    CreditCardPaymentMethodProps &
        WithCheckoutCreditCardPaymentMethodProps &
        WithFormProps &
        WithPaymentProps &
        WithLanguageProps &
        ConnectFormikProps<PaymentFormValues>,
    CreditCardPaymentMethodState
> {
    state: CreditCardPaymentMethodState = {
        hostedFieldsetKey: 0,
        isAddingNewCard: false,
        isPreloaderOn: true,
    };

    private mounted = false;
    private fieldTimer?: number;
    private holdingSubmit = false;

    async componentDidMount(): Promise<void> {
        this.mounted = true;

        const {
            initializePayment,
            isInstrumentFeatureAvailable: isInstrumentFeatureAvailableProp,
            loadInstruments,
            method,
            onUnhandledError = noop,
            setValidationSchema,
        } = this.props;

        setValidationSchema(method, this.getValidationSchema());
        configureCardValidator();

        try {
            if (isInstrumentFeatureAvailableProp) {
                await loadInstruments();
            }

            if (!this.mounted) return;

            const instrument = this.getSelectedInstrument();
            const initialize = () =>
                initializePayment(
                    {
                        gatewayId: method.gateway,
                        methodId: method.id,
                        integrations: [createLegacyPaymentStrategy],
                    },
                    instrument,
                );

            if (
                method.id === 'bigpaypay' &&
                !method.gateway &&
                this.props.cardFieldset &&
                !instrument
            ) {
                await this.initializeTestProviderFields(initialize);
            } else {
                await initialize();
            }

            if (this.mounted) this.setState({ isPreloaderOn: false });
        } catch (error) {
            if (this.mounted) onUnhandledError(error);
        }
    }

    private async initializeTestProviderFields(initialize: () => Promise<CheckoutSelectors>) {
        const { disableSubmit, language, method } = this.props;

        this.holdingSubmit = true;
        disableSubmit(method, true);

        const attachFields = async (): Promise<boolean> => {
            let timedOut = false;

            // Detaching the incomplete fields cancels the SDK's pending attach and releases
            // its payment queue. Start a new initialization only after that cancellation.
            this.fieldTimer = window.setTimeout(() => {
                timedOut = true;
                flushSync(() =>
                    this.setState(({ hostedFieldsetKey }) => ({
                        hostedFieldsetKey: hostedFieldsetKey + 1,
                    })),
                );
            }, 30_000);

            try {
                await initialize();
                if (!this.mounted) return false;
                if (!timedOut) return true;

                // A late success still owns the form whose fields were replaced.
                await this.props.deinitializePayment({
                    methodId: method.id,
                    gatewayId: method.gateway,
                });
            } catch (error) {
                if (!this.mounted) return false;

                if (
                    !timedOut ||
                    !isErrorWithType(error) ||
                    error.type !== 'unexpected_detachment'
                ) {
                    throw error;
                }
            } finally {
                window.clearTimeout(this.fieldTimer);
            }

            return false;
        };

        const ready = (await attachFields()) || (this.mounted && (await attachFields()));

        if (!this.mounted) return;
        if (!ready) throw new Error(language.translate('payment.payment_method_unavailable_error'));

        this.holdingSubmit = false;
        disableSubmit(method, false);
    }

    async componentWillUnmount(): Promise<void> {
        this.mounted = false;
        window.clearTimeout(this.fieldTimer);
        if (this.holdingSubmit) this.props.disableSubmit(this.props.method, false);

        const {
            deinitializePayment,
            method,
            onUnhandledError = noop,
            setValidationSchema,
        } = this.props;

        setValidationSchema(method, null);

        try {
            await deinitializePayment({
                gatewayId: method.gateway,
                methodId: method.id,
            });
        } catch (error) {
            onUnhandledError(error);
        }
    }

    async componentDidUpdate(
        _prevProps: Readonly<CreditCardPaymentMethodProps>,
        prevState: Readonly<CreditCardPaymentMethodState>,
    ): Promise<void> {
        const {
            deinitializePayment,
            initializePayment,
            method,
            onUnhandledError = noop,
            setValidationSchema,
        } = this.props;

        const { isAddingNewCard, selectedInstrumentId } = this.state;

        setValidationSchema(method, this.getValidationSchema());

        if (
            selectedInstrumentId !== prevState.selectedInstrumentId ||
            isAddingNewCard !== prevState.isAddingNewCard
        ) {
            try {
                await deinitializePayment({
                    gatewayId: method.gateway,
                    methodId: method.id,
                });

                await initializePayment(
                    {
                        gatewayId: method.gateway,
                        methodId: method.id,
                        integrations: [createLegacyPaymentStrategy],
                    },
                    this.getSelectedInstrument(),
                );
            } catch (error) {
                onUnhandledError(error);
            }
        }
    }

    render(): ReactNode {
        const {
            cardFieldset,
            getStoredCardValidationFieldset,
            instruments,
            isInitializing,
            isInstrumentCardCodeRequired: isInstrumentCardCodeRequiredProp,
            isInstrumentCardNumberRequired: isInstrumentCardNumberRequiredProp,
            isInstrumentFeatureAvailable: isInstrumentFeatureAvailableProp,
            isLoadingInstruments,
            shouldShowInstrumentFieldset,
            method,
        } = this.props;

        const { isAddingNewCard, isPreloaderOn } = this.state;

        const selectedInstrument = this.getSelectedInstrument();
        const shouldShowCreditCardFieldset = !shouldShowInstrumentFieldset || isAddingNewCard;
        const isLoading = isInitializing || isLoadingInstruments || isPreloaderOn;
        const shouldShowNumberField = selectedInstrument
            ? isInstrumentCardNumberRequiredProp(selectedInstrument)
            : false;
        const shouldShowCardCodeField = selectedInstrument
            ? isInstrumentCardCodeRequiredProp(selectedInstrument, method)
            : false;

        return (
            <LoadingOverlay hideContentWhenLoading isLoading={isLoading}>
                <div
                    className="paymentMethod paymentMethod--creditCard"
                    data-test="credit-cart-payment-method"
                >
                    {shouldShowInstrumentFieldset && (
                        <CardInstrumentFieldset
                            instruments={instruments}
                            onDeleteInstrument={this.handleDeleteInstrument}
                            onSelectInstrument={this.handleSelectInstrument}
                            onUseNewInstrument={this.handleUseNewCard}
                            selectedInstrumentId={
                                selectedInstrument && selectedInstrument.bigpayToken
                            }
                            validateInstrument={
                                getStoredCardValidationFieldset ? (
                                    getStoredCardValidationFieldset(selectedInstrument)
                                ) : (
                                    <CreditCardValidation
                                        shouldShowCardCodeField={shouldShowCardCodeField}
                                        shouldShowNumberField={shouldShowNumberField}
                                    />
                                )
                            }
                        />
                    )}

                    {shouldShowCreditCardFieldset && !cardFieldset && (
                        <CreditCardFieldset
                            shouldShowCardCodeField={
                                method.config.cardCode || method.config.cardCode === null
                            }
                            shouldShowCustomerCodeField={method.config.requireCustomerCode}
                        />
                    )}

                    {shouldShowCreditCardFieldset && cardFieldset && (
                        <Fragment key={this.state.hostedFieldsetKey}>{cardFieldset}</Fragment>
                    )}

                    {isInstrumentFeatureAvailableProp && (
                        <StoreInstrumentFieldset
                            instrumentId={selectedInstrument && selectedInstrument.bigpayToken}
                        />
                    )}
                </div>
            </LoadingOverlay>
        );
    }

    private getSelectedInstrument(): CardInstrument | undefined {
        const { instruments } = this.props;
        const { selectedInstrumentId = this.getDefaultInstrumentId() } = this.state;

        return find(instruments, { bigpayToken: selectedInstrumentId });
    }

    private getDefaultInstrumentId(): string | undefined {
        const { isAddingNewCard } = this.state;

        if (isAddingNewCard) {
            return;
        }

        const { instruments } = this.props;
        const defaultInstrument =
            instruments.find((instrument) => instrument.defaultInstrument) || instruments[0];

        return defaultInstrument && defaultInstrument.bigpayToken;
    }

    private getValidationSchema(): ObjectSchema | null {
        const {
            cardValidationSchema,
            isInstrumentCardCodeRequired: isInstrumentCardCodeRequiredProp,
            isInstrumentCardNumberRequired: isInstrumentCardNumberRequiredProp,
            isInstrumentFeatureAvailable: isInstrumentFeatureAvailableProp,
            isPaymentDataRequired,
            language,
            method,
            storedCardValidationSchema,
        } = this.props;

        if (!isPaymentDataRequired) {
            return null;
        }

        const selectedInstrument = this.getSelectedInstrument();

        if (isInstrumentFeatureAvailableProp && selectedInstrument) {
            return (
                storedCardValidationSchema ||
                getInstrumentValidationSchema({
                    instrumentBrand: selectedInstrument.brand,
                    instrumentLast4: selectedInstrument.last4,
                    isCardCodeRequired: isInstrumentCardCodeRequiredProp(
                        selectedInstrument,
                        method,
                    ),
                    isCardNumberRequired: isInstrumentCardNumberRequiredProp(selectedInstrument),
                    language,
                })
            );
        }

        return (
            cardValidationSchema ||
            getCreditCardValidationSchema({
                isCardCodeRequired: method.config.cardCode === true,
                language,
            })
        );
    }

    private handleUseNewCard: () => void = () => {
        const {
            formik: { setFieldValue },
        } = this.props;

        setFieldValue('hostedForm.cardType', '');

        this.setState({
            isAddingNewCard: true,
            selectedInstrumentId: undefined,
        });
    };

    private handleSelectInstrument: (id: string) => void = (id) => {
        const {
            formik: { setFieldValue },
        } = this.props;

        setFieldValue('hostedForm.cardType', '');

        this.setState({
            isAddingNewCard: false,
            selectedInstrumentId: id,
        });
    };

    private handleDeleteInstrument: (id: string) => void = (id) => {
        const {
            instruments,
            formik: { setFieldValue },
        } = this.props;
        const { selectedInstrumentId } = this.state;

        if (instruments.length === 0) {
            this.setState({
                isAddingNewCard: true,
                selectedInstrumentId: undefined,
            });

            setFieldValue('instrumentId', '');
        } else if (selectedInstrumentId === id) {
            this.setState({
                selectedInstrumentId: this.getDefaultInstrumentId(),
            });

            setFieldValue('instrumentId', this.getDefaultInstrumentId());
        }
    };
}

const mapFromCheckoutProps: MapToPropsFactory<
    CheckoutContextProps,
    WithCheckoutCreditCardPaymentMethodProps,
    CreditCardPaymentMethodProps & ConnectFormikProps<PaymentFormValues>
> = () => {
    const filterInstruments = memoizeOne((instruments: PaymentInstrument[] = []) =>
        instruments.filter(isCardInstrument),
    );

    return (context, props) => {
        const { method } = props;

        const { checkoutService, checkoutState } = context;

        const {
            data: { getConfig, getCustomer, getInstruments, isPaymentDataRequired },
            statuses: { isLoadingInstruments },
        } = checkoutState;

        const config = getConfig();
        const customer = getCustomer();

        if (!config || !customer || !method) {
            return null;
        }

        const instruments = filterInstruments(getInstruments(method));
        const isInstrumentFeatureAvailableProp = isInstrumentFeatureAvailable({
            config,
            customer,
            paymentMethod: method,
        });

        return {
            instruments,
            isCardCodeRequired: method.config.cardCode || method.config.cardCode === null,
            isCustomerCodeRequired: !!method.config.requireCustomerCode,
            isInstrumentCardCodeRequired: isInstrumentCardCodeRequiredSelector(checkoutState),
            isInstrumentCardNumberRequired: isInstrumentCardNumberRequiredSelector(checkoutState),
            isInstrumentFeatureAvailable: isInstrumentFeatureAvailableProp,
            isLoadingInstruments: isLoadingInstruments(),
            isPaymentDataRequired: isPaymentDataRequired(),
            loadInstruments: checkoutService.loadInstruments,
            shouldShowInstrumentFieldset:
                isInstrumentFeatureAvailableProp && instruments.length > 0,
        };
    };
};

export default connectFormik(
    withForm(
        withLanguage(withPayment(withCheckout(mapFromCheckoutProps)(CreditCardPaymentMethod))),
    ),
);
