import React, { createContext, type PropsWithChildren, useSyncExternalStore } from 'react';

import { useCheckout } from '@bigcommerce/checkout/contexts';

import { freightEndpoint } from './freight';
import { getShippingQuoteStatus, subscribeShippingQuote } from './shippingQuoteState';

export const ShippingQuoteSummaryContext = createContext<{
    managed: boolean;
    shipping?: string;
    total?: string;
}>({ managed: false });

export default function ShippingQuoteSummary({ children }: PropsWithChildren) {
    const status = useSyncExternalStore(subscribeShippingQuote, getShippingQuoteStatus);
    const { selectedState: consignments } = useCheckout(({ data }) => data.getConsignments());
    const managed = !!freightEndpoint();
    const confirmed =
        status === 'ready' &&
        !!consignments?.length &&
        consignments.every((item) => !!item.selectedPickupOption || !!item.selectedShippingOption);
    const shipping =
        !managed || confirmed
            ? undefined
            : status === 'loading'
              ? 'Recalculating shipping…'
              : status === 'failed'
                ? 'Shipping unavailable — retry'
                : status === 'ready'
                  ? 'Choose a shipping rate'
                  : 'Review delivery options';

    return (
        <ShippingQuoteSummaryContext.Provider
            value={{
                managed,
                shipping,
                total: shipping ? 'Pending delivery confirmation' : undefined,
            }}
        >
            {children}
        </ShippingQuoteSummaryContext.Provider>
    );
}
