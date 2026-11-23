import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, ButtonVariant, Tooltip, TooltipTrigger } from '@bigcommerce/checkout/ui';

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
    shippingActionsTarget,
    onApply,
    onReady,
    onUnready,
}: {
    pickup: boolean;
    ready: boolean;
    busy?: boolean;
    shippingActionsTarget?: HTMLElement | null;
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
            setError(
                pickup
                    ? 'Unable to load pickup preferences. Please retry.'
                    : 'Unable to load delivery preferences. Choose a shipping address, then select Reset shipping.',
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (enabled) void reload(false);
    }, [enabled, pickup]);
    if (!enabled) return null;

    const actions = (
        <div className="warehouseDelivery-actions">
            <Button
                aria-busy={pickup ? undefined : loading}
                className={
                    pickup
                        ? 'optimizedCheckout-buttonSecondary'
                        : 'body-bold warehouseDelivery-getRates'
                }
                disabled={!data || loading || busy}
                onClick={async () => {
                    setLoading(true);
                    setError('');
                    onUnready();
                    setShippingQuoteStatus('loading');

                    try {
                        const success = await onApply(pickup ? [] : codes);

                        setShippingQuoteStatus(success ? 'ready' : 'failed');
                        if (!success)
                            setError('Delivery options were not confirmed. Please retry.');
                    } catch {
                        invalidateFreight();
                        setShippingQuoteStatus('failed');
                        onUnready();
                        setError('Delivery options were not confirmed. Please retry.');
                    } finally {
                        setLoading(false);
                    }
                }}
                type="button"
                variant={pickup ? undefined : ButtonVariant.Primary}
            >
                {pickup ? (
                    loading ? (
                        'Checking delivery preferences…'
                    ) : (
                        'Confirm pickup preferences'
                    )
                ) : (
                    <span>Get rates</span>
                )}
            </Button>
            {(!pickup || error) && (
                <button
                    className="warehouseDelivery-reload"
                    disabled={loading || busy}
                    onClick={() => {
                        void reload();
                    }}
                    type="button"
                >
                    {pickup ? 'Retry pickup preferences' : 'Reset shipping'}
                </button>
            )}
        </div>
    );

    return (
        <section
            className={
                pickup ? 'warehouseDelivery' : 'warehouseDelivery warehouseDelivery--shipping'
            }
            data-test="freight-delivery"
        >
            <h3 className="warehouseDelivery-title">
                {pickup ? 'Pickup confirmation' : 'Delivery services'}
            </h3>
            {!pickup && (
                <p className="warehouseDelivery-notice">
                    <svg
                        aria-hidden="true"
                        fill="none"
                        height="15"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        width="15"
                    >
                        <path d="M10.3 4a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3zM12 9v4m0 3v.1" />
                    </svg>
                    Select services to ensure proper delivery
                </p>
            )}
            <fieldset
                aria-label={pickup ? 'Pickup preferences' : 'Freight preferences'}
                className="warehouseDelivery-fields"
                disabled={loading || busy}
            >
                {!pickup && (
                    <div className="warehouseDelivery-services">
                        {data?.services.map((service) => (
                            <div className="warehouseDelivery-service" key={service.code}>
                                <label>
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
                                    />
                                    {service.label}
                                </label>
                                {service.description && (
                                    <TooltipTrigger
                                        ariaLabel={`About ${service.label}`}
                                        tooltip={<Tooltip>{service.description}</Tooltip>}
                                    >
                                        <span aria-hidden="true" className="warehouseDelivery-info">
                                            i
                                        </span>
                                    </TooltipTrigger>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {error && <p role="alert">{error}</p>}
                {pickup && ready && freightApproved(pickup) && (
                    <p role="status">Pickup confirmed. Shipping charges cleared.</p>
                )}
                {pickup
                    ? actions
                    : shippingActionsTarget && createPortal(actions, shippingActionsTarget)}
            </fieldset>
        </section>
    );
}
