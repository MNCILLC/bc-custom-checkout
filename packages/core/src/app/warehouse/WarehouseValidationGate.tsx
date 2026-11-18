import { type CheckoutService } from '@bigcommerce/checkout-sdk/essential';
import React, { type ReactNode, useEffect, useState } from 'react';

import { getWarehouseCheckout } from './config';
import { warehouseSubmissionInProgress } from './submissionState';
import { validateCurrentWarehouse, warehouseTransitionInProgress } from './validation';

export default function WarehouseValidationGate({
    checkoutService,
    children,
}: {
    checkoutService: CheckoutService;
    children: ReactNode;
}) {
    const [ready, setReady] = useState(!getWarehouseCheckout());
    const [checking, setChecking] = useState(!!getWarehouseCheckout());
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [submitting, setSubmitting] = useState(warehouseSubmissionInProgress());

    useEffect(() => {
        const update = () => setSubmitting(warehouseSubmissionInProgress());

        window.addEventListener('warehouse-submission-state', update);

        return () => window.removeEventListener('warehouse-submission-state', update);
    }, []);

    useEffect(() => {
        if (!getWarehouseCheckout()) return;

        let active = true;
        let running = false;
        let queued = false;
        let debounce: number | undefined;
        const validate = async (refresh = false) => {
            if (warehouseTransitionInProgress() || warehouseSubmissionInProgress()) return;

            if (running) {
                queued = true;

                return;
            }

            running = true;
            setChecking(true);

            try {
                const config = getWarehouseCheckout();

                if (refresh && config && checkoutService.getState().data.getCheckout()) {
                    await checkoutService.loadCheckout(config.cartId);
                }

                await validateCurrentWarehouse();

                if (active) {
                    setError('');
                    setReady(true);
                }
            } catch (failure) {
                if (active)
                    setError(
                        failure instanceof Error
                            ? failure.message
                            : 'Warehouse verification failed.',
                    );
            } finally {
                running = false;

                if (active) {
                    setChecking(false);

                    if (queued) {
                        queued = false;
                        void validate();
                    }
                }
            }
        };
        const schedule = () => {
            window.clearTimeout(debounce);
            debounce = window.setTimeout(() => {
                void validate();
            }, 350);
        };
        const unsubscribe = checkoutService.subscribe(schedule, (state) =>
            JSON.stringify({
                cart: state.data.getCart(),
                consignments: state.data.getConsignments(),
            }),
        );
        const focus = () => {
            void validate(true);
        };
        const visible = () => {
            if (!document.hidden) void validate(true);
        };
        const timer = window.setInterval(visible, 15000);

        window.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', visible);
        void validate(true);

        return () => {
            active = false;
            unsubscribe();
            window.clearInterval(timer);
            window.clearTimeout(debounce);
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [checkoutService, retry]);

    return (
        <>
            {(checking || submitting || error) && (
                <div
                    data-test="warehouse-validation"
                    role={error ? 'alert' : 'status'}
                    style={{ padding: '16px 24px' }}
                >
                    {error || 'Verifying your warehouse and inventory…'}
                    {!!error && (
                        <button
                            className="button optimizedCheckout-buttonSecondary"
                            onClick={() => setRetry((value) => value + 1)}
                            type="button"
                        >
                            Retry verification
                        </button>
                    )}
                </div>
            )}
            <fieldset
                data-test="warehouse-validation-content"
                disabled={checking || submitting || !!error}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
                {ready && children}
            </fieldset>
        </>
    );
}
