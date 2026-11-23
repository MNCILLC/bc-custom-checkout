import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import {
    freightApproved,
    freightEndpoint,
    invalidateFreight,
    loadFreightPreferences,
} from './freight';
import FreightDelivery from './FreightDelivery';

jest.mock('./freight', () => ({
    freightApproved: jest.fn(),
    freightEndpoint: jest.fn(),
    invalidateFreight: jest.fn(),
    loadFreightPreferences: jest.fn(),
}));

let afterAddress: HTMLDivElement;

beforeEach(() => {
    jest.clearAllMocks();
    afterAddress = document.createElement('div');
    document.body.append(afterAddress);
    (freightEndpoint as jest.Mock).mockReturnValue('https://backend.invalid/freight');
    (freightApproved as jest.Mock).mockReturnValue(false);
    (loadFreightPreferences as jest.Mock).mockResolvedValue({
        preferences: null,
        services: [{ code: 'HYD', label: 'Liftgate', description: 'Ground delivery' }],
    });
});
afterEach(() => afterAddress.remove());
it('applies selected services and marks changed options unready', async () => {
    const apply = jest.fn().mockResolvedValue(true);
    const unready = jest.fn();

    const props = {
        onApply: apply,
        onReady: jest.fn(),
        onUnready: unready,
        pickup: false,
        shippingActionsTarget: afterAddress,
    };
    const { rerender } = render(<FreightDelivery {...props} ready={false} />);

    const choice = await screen.findByRole('checkbox');

    expect(screen.getByRole('heading', { name: 'Delivery services' })).toBeVisible();

    const help = screen.getByRole('button', { name: 'About Liftgate' });

    fireEvent.focus(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ground delivery');
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(choice).not.toBeChecked();
    fireEvent.click(choice);
    expect(invalidateFreight).toHaveBeenCalled();
    expect(unready).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Get rates'));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(['HYD']));
    (freightApproved as jest.Mock).mockReturnValue(true);
    rerender(<FreightDelivery {...props} ready />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('offers a usable retry after load failure', async () => {
    (loadFreightPreferences as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    render(
        <FreightDelivery
            onApply={jest.fn()}
            onReady={jest.fn()}
            onUnready={jest.fn()}
            pickup={false}
            ready={false}
            shippingActionsTarget={afterAddress}
        />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load');
    fireEvent.click(screen.getByText('Reset shipping'));
    expect(await screen.findByRole('checkbox')).toBeEnabled();
});
it('handles a rejected apply without enabling continuation', async () => {
    const ready = jest.fn();

    render(
        <FreightDelivery
            onApply={jest.fn().mockRejectedValue(new Error('recovery failed'))}
            onReady={ready}
            onUnready={jest.fn()}
            pickup={false}
            ready={false}
            shippingActionsTarget={afterAddress}
        />,
    );
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByText('Get rates'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
    expect(ready).not.toHaveBeenCalled();
});
it('pickup hides delivery services and clears selected codes', async () => {
    const apply = jest.fn().mockResolvedValue(true);

    render(
        <FreightDelivery
            onApply={apply}
            onReady={jest.fn()}
            onUnready={jest.fn()}
            pickup
            ready={false}
        />,
    );
    await waitFor(() => expect(screen.getByText('Confirm pickup preferences')).toBeEnabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset shipping')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm pickup preferences'));
    await waitFor(() => expect(apply).toHaveBeenCalledWith([]));
});

it('allows a failed pickup preferences read to be retried without a shipping address', async () => {
    (loadFreightPreferences as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    render(
        <FreightDelivery
            onApply={jest.fn()}
            onReady={jest.fn()}
            onUnready={jest.fn()}
            pickup
            ready={false}
        />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Retry pickup preferences' }));
    await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Confirm pickup preferences' })).toBeEnabled(),
    );
    expect(screen.queryByRole('button', { name: 'Reset shipping' })).not.toBeInTheDocument();
});

it('shows pickup confirmation when approval arrives after the replacement panel has loaded', async () => {
    const props = { onApply: jest.fn(), onReady: jest.fn(), onUnready: jest.fn(), pickup: true };
    const { rerender } = render(<FreightDelivery {...props} ready={false} />);

    await screen.findByRole('button', { name: 'Confirm pickup preferences' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    (freightApproved as jest.Mock).mockReturnValue(true);
    rerender(<FreightDelivery {...props} ready />);
    expect(screen.getByRole('status')).toHaveTextContent(
        'Pickup confirmed. Shipping charges cleared.',
    );

    (freightApproved as jest.Mock).mockReturnValue(false);
    rerender(<FreightDelivery {...props} ready />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(props.onApply).not.toHaveBeenCalled();
    expect(loadFreightPreferences).toHaveBeenCalledTimes(1);
});
