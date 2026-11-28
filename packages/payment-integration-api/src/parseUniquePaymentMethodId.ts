export default function parseUniquePaymentMethodId(value: string): {
    methodId: string;
    gatewayId?: string;
} {
    const prefix = /^pm--(\d+)-/.exec(value);

    if (prefix) {
        const ids = value.slice(prefix[0].length);
        const gatewayLength = Number(prefix[1]);

        if (ids[gatewayLength] !== '-') {
            throw new Error('Invalid payment method selection. Choose a payment method again.');
        }

        return {
            gatewayId: ids.slice(0, gatewayLength) || undefined,
            methodId: ids.slice(gatewayLength + 1),
        };
    }

    const separator = value.indexOf('-');

    if (separator === -1) {
        return { gatewayId: undefined, methodId: value };
    }

    if (value.lastIndexOf('-') !== separator) {
        // An older form value with multiple separators cannot identify the selected pair.
        throw new Error('Invalid payment method selection. Choose a payment method again.');
    }

    return { gatewayId: value.slice(0, separator), methodId: value.slice(separator + 1) };
}
