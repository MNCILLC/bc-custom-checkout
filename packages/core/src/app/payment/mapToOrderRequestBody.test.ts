import { getYear } from '@bigcommerce/checkout/test-mocks';

import mapToOrderRequestBody from './mapToOrderRequestBody';
import getUniquePaymentMethodId from './paymentMethod/getUniquePaymentMethodId';

describe('mapToOrderRequestBody()', () => {
    it.each([
        { methodId: 'fixture-card', gatewayId: 'fixture-gateway' },
        { methodId: 'fixture-card', gatewayId: 'fixture' },
        { methodId: 'card', gatewayId: 'fixture-gateway' },
        { methodId: 'fixture-card', gatewayId: undefined },
        { methodId: '-card--', gatewayId: '--gateway-' },
        { methodId: 'pm--2-ab-card', gatewayId: undefined },
    ])('preserves the selected method $methodId and gateway $gatewayId', (pair) => {
        const paymentProviderRadio = getUniquePaymentMethodId(pair.methodId, pair.gatewayId);

        expect(mapToOrderRequestBody({ paymentProviderRadio }, true).payment).toEqual(pair);
    });

    it('distinguishes pairs that used to produce the same radio value', () => {
        const values = [
            getUniquePaymentMethodId('a-b', 'c'),
            getUniquePaymentMethodId('b', 'c-a'),
            getUniquePaymentMethodId('c-a-b'),
        ];

        expect(new Set(values).size).toBe(3);
    });

    it.each([
        { methodId: 'cheque', gatewayId: undefined, value: 'cheque' },
        { methodId: 'bigpaypay', gatewayId: undefined, value: 'bigpaypay' },
        { methodId: 'paypal', gatewayId: 'adyen', value: 'adyen-paypal' },
    ])('retains the existing radio value for $methodId', ({ methodId, gatewayId, value }) => {
        expect(getUniquePaymentMethodId(methodId, gatewayId)).toBe(value);
    });

    it.each(['pm--99-ab-card', 'gateway-method-extra'])(
        'rejects an unresolvable radio value %s',
        (paymentProviderRadio) => {
            expect(() => mapToOrderRequestBody({ paymentProviderRadio }, true)).toThrow(
                'Invalid payment method selection',
            );
        },
    );

    it('transforms credit card form values into order payload', () => {
        const year = getYear(-2);
        const cardDataYear = year.slice(-2);
        const result = mapToOrderRequestBody(
            {
                ccCvv: '123',
                ccExpiry: `12/${cardDataYear}`,
                ccName: 'Big Shopper',
                ccNumber: '4111 1111 1111 1111',
                shouldSaveInstrument: true,
                paymentProviderRadio: 'authorizenet',
            },
            true,
        );

        expect(result).toEqual({
            payment: {
                gatewayId: undefined,
                methodId: 'authorizenet',
                paymentData: {
                    ccCvv: '123',
                    ccExpiry: {
                        month: '12',
                        year,
                    },
                    ccName: 'Big Shopper',
                    ccNumber: '4111111111111111',
                    shouldSaveInstrument: true,
                },
            },
        });
    });

    it('transforms stored instrument form values into order payload', () => {
        const result = mapToOrderRequestBody(
            {
                ccCvv: '123',
                ccNumber: '4111 1111 1111 1111',
                instrumentId: 'abc',
                paymentProviderRadio: 'authorizenet',
            },
            true,
        );

        expect(result).toEqual({
            payment: {
                gatewayId: undefined,
                methodId: 'authorizenet',
                paymentData: {
                    ccCvv: '123',
                    ccNumber: '4111111111111111',
                    instrumentId: 'abc',
                },
            },
        });
    });

    it('transforms hosted / offsite / offline method form values into order payload', () => {
        const result = mapToOrderRequestBody(
            {
                paymentProviderRadio: 'adyen-paypal',
            },
            true,
        );

        expect(result).toEqual({
            payment: {
                gatewayId: 'adyen',
                methodId: 'paypal',
            },
        });
    });

    it('uses methodIdOverride as methodId when provided', () => {
        const result = mapToOrderRequestBody(
            {
                paymentProviderRadio: 'adyen-paypal',
                methodIdOverride: 'scheme',
            },
            true,
        );

        expect(result).toEqual({
            payment: {
                gatewayId: 'adyen',
                methodId: 'scheme',
            },
        });
    });

    it('falls back to parsed methodId when methodIdOverride is an empty string', () => {
        const result = mapToOrderRequestBody(
            {
                paymentProviderRadio: 'adyen-paypal',
                methodIdOverride: '',
            },
            true,
        );

        expect(result).toEqual({
            payment: {
                gatewayId: 'adyen',
                methodId: 'paypal',
            },
        });
    });

    it('transforms form values into order payload for order that does not required additional payment details', () => {
        const result = mapToOrderRequestBody(
            {
                paymentProviderRadio: 'authorizenet',
            },
            false,
        );

        expect(result).toEqual({});
    });
});
