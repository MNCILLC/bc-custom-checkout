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
beforeEach(() => {
    jest.clearAllMocks();
    (freightEndpoint as jest.Mock).mockReturnValue('https://backend.invalid/freight');
    (freightApproved as jest.Mock).mockReturnValue(false);
    (loadFreightPreferences as jest.Mock).mockResolvedValue({
        preferences: null,
        services: [{ code: 'HYD', label: 'Liftgate', description: 'Ground delivery' }],
    });
});
it('applies selected services and marks changed options unready', async () => {
    const apply = jest.fn().mockResolvedValue(true);
    const unready = jest.fn();

    render(
        <FreightDelivery onApply={apply} onReady={jest.fn()} onUnready={unready} pickup={false} />,
    );

    const choice = await screen.findByRole('checkbox');

    fireEvent.click(choice);
    expect(invalidateFreight).toHaveBeenCalled();
    expect(unready).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Apply delivery options & refresh rates'));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(['HYD']));
    expect(await screen.findByRole('status')).toHaveTextContent('Delivery options saved');
});
it('offers a usable retry after load failure', async () => {
    (loadFreightPreferences as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    render(
        <FreightDelivery
            onApply={jest.fn()}
            onReady={jest.fn()}
            onUnready={jest.fn()}
            pickup={false}
        />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load');
    fireEvent.click(screen.getByText('Reload preferences'));
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
        />,
    );
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByText('Apply delivery options & refresh rates'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
    expect(ready).not.toHaveBeenCalled();
});
it('pickup hides delivery services and clears selected codes', async () => {
    const apply = jest.fn().mockResolvedValue(true);

    render(<FreightDelivery onApply={apply} onReady={jest.fn()} onUnready={jest.fn()} pickup />);
    await waitFor(() => expect(screen.getByText('Confirm pickup preferences')).toBeEnabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm pickup preferences'));
    await waitFor(() => expect(apply).toHaveBeenCalledWith([]));
});
