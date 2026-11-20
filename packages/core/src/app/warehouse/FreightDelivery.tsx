import React, { useEffect, useState } from 'react';

import {
    freightApproved,
    freightEndpoint,
    type FreightResponse,
    invalidateFreight,
    loadFreightPreferences,
} from './freight';
import { setShippingQuoteStatus } from './shippingQuoteState';

export default function FreightDelivery({
    pickup,
    ready,
    busy = false,
    onApply,
    onReady,
    onUnready,
}: {
    pickup: boolean;
    ready: boolean;
    busy?: boolean;
    onApply(codes: string[]): Promise<boolean>;
    onUnready(): void;
    onReady(): void;
}) {
    const [data, setData] = useState<FreightResponse>();
    const [codes, setCodes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const enabled = !!freightEndpoint();
    const reload = async (reset = true) => {
        setLoading(true);
        setError('');
        if (reset) invalidateFreight();
        onUnready();
        setShippingQuoteStatus('loading');

        try {
            const result = await loadFreightPreferences();

            setData(result);
            setCodes(result.preferences?.accessorials ?? []);

            if (freightApproved(pickup)) {
                onReady();
                setShippingQuoteStatus('ready');
            } else {
                setShippingQuoteStatus('review');
            }
        } catch {
            setShippingQuoteStatus('failed');
            setError('Unable to load delivery preferences. Reload preferences to retry.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (enabled) void reload(false);
    }, [enabled, pickup]);
    if (!enabled) return null;

    return (
        <section className="form-fieldset" data-test="freight-delivery">
            <h3 className="body-bold">
                {pickup ? 'Pickup confirmation' : 'Freight delivery options'}
            </h3>
            {!pickup && (
                <p>
                    Select the delivery services you need, then apply them before requesting
                    shipping rates.
                </p>
            )}
            <fieldset disabled={loading || busy} style={{ border: 0, padding: 0 }}>
                {!pickup &&
                    data?.services.map((service) => (
                        <label key={service.code} style={{ display: 'block', marginBottom: 12 }}>
                            <input
                                checked={codes.includes(service.code)}
                                onChange={(event) => {
                                    setCodes(
                                        event.target.checked
                                            ? [...codes, service.code]
                                            : codes.filter((code) => code !== service.code),
                                    );
                                    invalidateFreight();
                                    onUnready();
                                }}
                                type="checkbox"
                            />{' '}
                            {service.label}
                            <span style={{ display: 'block', fontSize: 13 }}>
                                {service.description}
                            </span>
                        </label>
                    ))}
                {error && <p role="alert">{error}</p>}
                {ready && freightApproved(pickup) && (
                    <p role="status">
                        {pickup
                            ? 'Pickup confirmed. Shipping charges cleared.'
                            : 'Delivery options saved. Choose a shipping rate below.'}
                    </p>
                )}
                <button
                    className="button optimizedCheckout-buttonSecondary"
                    disabled={!data || loading}
                    onClick={async () => {
                        setLoading(true);
                        setError('');
                        onUnready();
                        setShippingQuoteStatus('loading');

                        try {
                            const success = await onApply(pickup ? [] : codes);

                            setShippingQuoteStatus(success ? 'ready' : 'failed');
                            if (!success)
                                setError(
                                    'Delivery options were not confirmed. Reload preferences and retry.',
                                );
                        } catch {
                            invalidateFreight();
                            setShippingQuoteStatus('failed');
                            onUnready();
                            setError(
                                'Delivery options were not confirmed. Reload preferences and retry.',
                            );
                        } finally {
                            setLoading(false);
                        }
                    }}
                    type="button"
                >
                    {loading
                        ? 'Checking delivery preferences…'
                        : pickup
                          ? 'Confirm pickup preferences'
                          : 'Apply delivery options & refresh rates'}
                </button>
                <button
                    className="button optimizedCheckout-buttonSecondary"
                    onClick={() => {
                        void reload();
                    }}
                    type="button"
                >
                    Reload preferences
                </button>
            </fieldset>
        </section>
    );
}
