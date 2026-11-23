import React, { type ReactNode } from 'react';

import { type WarehouseCheckoutConfig } from './config';

import './WarehouseShipping.scss';

interface Props {
    warehouse: WarehouseCheckoutConfig['warehouse'];
    pickup: boolean;
    busy: boolean;
    shippingPrice?: ReactNode;
    onChange(pickup: boolean): void;
}

export function WarehouseFulfillmentOptions({
    warehouse,
    pickup,
    busy,
    shippingPrice,
    onChange,
}: Props) {
    const location = warehouse.pickupLabel.replace(/^pick\s*up\s+(?:at|from|in)\s+/i, '').trim();

    return (
        <fieldset
            aria-label="Fulfillment method"
            className="warehouseFulfillment"
            data-test="warehouse-fulfillment-choice"
            disabled={busy}
        >
            <label className="warehouseFulfillment-row">
                <input
                    checked={pickup || !warehouse.allowShipping}
                    data-test="warehouse-pickup"
                    name="warehouse-fulfillment"
                    onChange={() => onChange(true)}
                    type="radio"
                    value="pickup"
                />
                <span>Pickup at Warehouse</span>
                <span className="warehouseFulfillment-location">
                    <svg
                        aria-hidden="true"
                        fill="none"
                        height="16"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        width="16"
                    >
                        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
                        <circle cx="12" cy="10" r="2.5" />
                    </svg>
                    {location}
                </span>
            </label>
            {warehouse.allowShipping && (
                <label className="warehouseFulfillment-row">
                    <input
                        checked={!pickup}
                        data-test="warehouse-ship"
                        name="warehouse-fulfillment"
                        onChange={() => onChange(false)}
                        type="radio"
                        value="ship"
                    />
                    <span>Ship</span>
                    {!pickup && shippingPrice != null && (
                        <span className="warehouseFulfillment-price">{shippingPrice}</span>
                    )}
                </label>
            )}
        </fieldset>
    );
}
