import { type PaymentMethod } from '@bigcommerce/checkout-sdk';
import { useState } from 'react';

// Hosted card fields belong to the mounted payment method. Only the form that started
// this attempt keeps its selection while the SDK finishes using those fields.
export default function useTestProviderFields(
    cartId: string | undefined,
    methods: PaymentMethod[],
    defaultMethod?: PaymentMethod,
) {
    const [retained, setRetained] = useState<{ cartId: string; method: PaymentMethod }>();
    const active = retained && retained.cartId === cartId ? retained.method : undefined;

    const retainTestProviderFields = (attemptCartId: string, method?: PaymentMethod) => {
        if (attemptCartId !== cartId || method?.id !== 'bigpaypay' || method.gateway)
            throw new Error(
                'The selected Test payment provider has changed. Review your checkout.',
            );

        setRetained({ cartId: attemptCartId, method });

        return () => setRetained(undefined);
    };

    return {
        methods: active ? [active] : methods,
        defaultMethod: active ?? defaultMethod,
        retainTestProviderFields,
    };
}
