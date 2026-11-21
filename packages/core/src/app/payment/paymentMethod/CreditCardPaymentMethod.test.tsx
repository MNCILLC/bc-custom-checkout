import { type CheckoutSelectors, createCheckoutService } from '@bigcommerce/checkout-sdk';
import { Formik } from 'formik';
import { noop } from 'lodash';
import React, { act } from 'react';

import { CheckoutProvider, LocaleContext } from '@bigcommerce/checkout/contexts';
import { createLocaleContext } from '@bigcommerce/checkout/locale';
import { render, screen } from '@bigcommerce/checkout/test-utils';
import { FormContext } from '@bigcommerce/checkout/ui';

import { getStoreConfig } from '../../config/config.mock';
import { getCustomer } from '../../customer/customers.mock';
import { getPaymentMethod } from '../payment-methods.mock';
import PaymentContext from '../PaymentContext';

import CreditCardPaymentMethod from './CreditCardPaymentMethod';

function mountFields(provider = 'bigpaypay') {
    const service = createCheckoutService();
    const state = service.getState();
    const method = { ...getPaymentMethod(), id: provider };
    const config = getStoreConfig();
    const disableSubmit = jest.fn();
    const onError = jest.fn();
    const deinitialize = jest.fn().mockResolvedValue(state);
    let finish: () => void;
    let detach: () => void;

    const initialize = jest.fn(
        () =>
            new Promise<CheckoutSelectors>((resolve, reject) => {
                finish = () => resolve(state);
                detach = () =>
                    reject(
                        Object.assign(new Error('Hosted field detached'), {
                            type: 'unexpected_detachment',
                        }),
                    );
            }),
    );

    jest.spyOn(state.data, 'getConfig').mockReturnValue(config);
    jest.spyOn(state.data, 'getCustomer').mockReturnValue(getCustomer());

    const view = render(
        <CheckoutProvider checkoutService={service}>
            <LocaleContext.Provider value={createLocaleContext(config)}>
                <PaymentContext.Provider
                    value={{
                        disableSubmit,
                        setSubmit: noop,
                        setValidationSchema: noop,
                        hidePaymentSubmitButton: noop,
                    }}
                >
                    <FormContext.Provider value={{ isSubmitted: false, setSubmitted: noop }}>
                        <Formik initialValues={{}} onSubmit={noop}>
                            <CreditCardPaymentMethod
                                cardFieldset={<div data-test="hosted-fields" />}
                                deinitializePayment={deinitialize}
                                initializePayment={initialize}
                                method={method}
                                onUnhandledError={onError}
                            />
                        </Formik>
                    </FormContext.Provider>
                </PaymentContext.Provider>
            </LocaleContext.Provider>
        </CheckoutProvider>,
    );

    return {
        ...view,
        method,
        disableSubmit,
        onError,
        initialize,
        deinitialize,
        finish: () => finish(),
        detach: () => detach(),
    };
}

describe('Test payment provider hosted field initialization', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('waits for detachment before reinitializing and unlocks only when the new fields attach', async () => {
        const form = mountFields();
        const original = screen.getByTestId('hosted-fields');

        expect(form.disableSubmit.mock.calls).toEqual([[form.method, true]]);
        act(() => jest.advanceTimersByTime(30_000));

        const replacement = screen.getByTestId('hosted-fields');

        expect(replacement).not.toBe(original);
        expect(form.initialize).toHaveBeenCalledTimes(1);
        await act(async () => form.detach());
        expect(form.initialize).toHaveBeenCalledTimes(2);
        expect(form.disableSubmit).toHaveBeenCalledTimes(1);
        await act(async () => form.finish());
        expect(form.disableSubmit.mock.calls).toEqual([
            [form.method, true],
            [form.method, false],
        ]);
        act(() => jest.advanceTimersByTime(60_000));
        expect(screen.getByTestId('hosted-fields')).toBe(replacement);
        expect(form.onError).not.toHaveBeenCalled();
    });

    it('releases a form that finishes attaching after its fields were replaced', async () => {
        const form = mountFields();

        act(() => jest.advanceTimersByTime(30_000));
        await act(async () => form.finish());
        expect(form.deinitialize).toHaveBeenCalledWith({
            methodId: 'bigpaypay',
            gatewayId: undefined,
        });
        expect(form.initialize).toHaveBeenCalledTimes(2);
        expect(form.disableSubmit.mock.calls).toEqual([[form.method, true]]);
        await act(async () => form.finish());
        expect(form.disableSubmit).toHaveBeenLastCalledWith(form.method, false);
    });

    it('keeps submission blocked after the second attachment times out', async () => {
        const form = mountFields();

        act(() => jest.advanceTimersByTime(30_000));
        await act(async () => form.detach());
        act(() => jest.advanceTimersByTime(30_000));
        await act(async () => form.detach());

        expect(form.initialize).toHaveBeenCalledTimes(2);
        expect(form.onError).toHaveBeenCalledWith(expect.any(Error));
        expect(form.disableSubmit.mock.calls).toEqual([[form.method, true]]);
    });

    it('cancels the pending timeout when the shopper leaves the form', async () => {
        const form = mountFields();

        form.unmount();
        await act(async () => form.detach());
        act(() => jest.advanceTimersByTime(60_000));
        expect(form.initialize).toHaveBeenCalledTimes(1);
        expect(form.deinitialize).toHaveBeenCalledTimes(1);
        expect(form.disableSubmit).toHaveBeenLastCalledWith(form.method, false);
        expect(form.onError).not.toHaveBeenCalled();
    });

    it('leaves another provider in control of its hosted fields', async () => {
        const form = mountFields('authorizenet');
        const original = screen.getByTestId('hosted-fields');

        act(() => jest.advanceTimersByTime(60_000));
        await act(async () => form.finish());
        expect(screen.getByTestId('hosted-fields')).toBe(original);
        expect(form.initialize).toHaveBeenCalledTimes(1);
        expect(form.disableSubmit).not.toHaveBeenCalled();
    });
});
