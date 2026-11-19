import { act, render, screen } from '@testing-library/react';
import React, { useContext } from 'react';

import { useCheckout } from '@bigcommerce/checkout/contexts';

import { freightEndpoint } from './freight';
import { setShippingQuoteStatus } from './shippingQuoteState';
import ShippingQuoteSummary, { ShippingQuoteSummaryContext } from './ShippingQuoteSummary';

jest.mock('@bigcommerce/checkout/contexts', () => ({ useCheckout: jest.fn() }));
jest.mock('./freight', () => ({ freightEndpoint: jest.fn() }));
jest.mock('./config', () => ({
    getWarehouseCheckout: () => ({ cartId: 'test', validation: { revision: '1' } }),
}));

function Summary() {
    const quote = useContext(ShippingQuoteSummaryContext);

    return (
        <div>
            {quote.shipping || 'Confirmed shipping'} / {quote.total || 'Confirmed total'}
        </div>
    );
}

beforeEach(() => {
    (freightEndpoint as jest.Mock).mockReturnValue('https://backend.invalid/freight');
    (useCheckout as jest.Mock).mockReturnValue({
        selectedState: [{ selectedShippingOption: { id: 'old-quote' } }],
    });
    setShippingQuoteStatus('ready');
});

it('hides old SDK amounts on edits, refresh, and failure, then restores confirmed amounts', () => {
    render(
        <ShippingQuoteSummary>
            <Summary />
        </ShippingQuoteSummary>,
    );
    expect(screen.getByText(/Confirmed total/)).toBeInTheDocument();
    act(() => setShippingQuoteStatus('review'));
    expect(screen.getByText(/Review delivery options/)).toBeInTheDocument();
    act(() => setShippingQuoteStatus('loading'));
    expect(screen.getByText(/Recalculating shipping/)).toBeInTheDocument();
    act(() => setShippingQuoteStatus('failed'));
    expect(screen.getByText(/Shipping unavailable/)).toHaveTextContent(
        'Pending delivery confirmation',
    );
    act(() => setShippingQuoteStatus('ready'));
    expect(screen.getByText(/Confirmed total/)).toBeInTheDocument();
});

it('waits for a selected shipping quote even after preferences are approved', () => {
    (useCheckout as jest.Mock).mockReturnValue({ selectedState: [{}] });
    render(
        <ShippingQuoteSummary>
            <Summary />
        </ShippingQuoteSummary>,
    );
    expect(screen.getByText(/Choose a shipping rate/)).toBeInTheDocument();
});

it('supports confirmed native pickup', () => {
    (useCheckout as jest.Mock).mockReturnValue({
        selectedState: [{ selectedPickupOption: { pickupMethodId: 2 } }],
    });
    render(
        <ShippingQuoteSummary>
            <Summary />
        </ShippingQuoteSummary>,
    );
    expect(screen.getByText(/Confirmed total/)).toBeInTheDocument();
});

it('leaves stores without the freight integration unchanged', () => {
    (freightEndpoint as jest.Mock).mockReturnValue(undefined);
    setShippingQuoteStatus('failed');
    render(
        <ShippingQuoteSummary>
            <Summary />
        </ShippingQuoteSummary>,
    );
    expect(screen.getByText(/Confirmed total/)).toBeInTheDocument();
});
