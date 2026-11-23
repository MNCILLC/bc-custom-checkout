import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';

import { configurePublicPath } from '../common/bundler';
import { getWarehouseCheckout, validateWarehouseCheckout } from '../warehouse/config';
import { getWarehouseDeployment } from '../warehouse/deployment';
import { restorePickupReview } from '../warehouse/freight';
import {
    cancelWarehouseInitialization,
    initializeWarehouseCheckout,
    warehouseInitializationEndpoint,
    WarehouseInventoryConflict,
} from '../warehouse/initialization';
import { showLocalCheckoutNotice } from '../warehouse/local-navigation';
import { installPurchaseGuards } from '../warehouse/purchaseGuards';
import { RECOVERY_MESSAGE, submissionNeedsReview } from '../warehouse/recovery';
import { RecoveryUnavailableError, validateCurrentWarehouse } from '../warehouse/validation';

import { type CheckoutAppProps } from './CheckoutApp';
import { initWhyDidYouRender } from './wdyr';

export type RenderCheckoutOptions = Omit<CheckoutAppProps, 'resolvedStockWarning'>;
export type RenderCheckout = typeof renderCheckout;

const initializations = new WeakMap<Element, symbol>();

export default function renderCheckout({
    containerId,
    publicPath,
    ...props
}: RenderCheckoutOptions): void {
    initWhyDidYouRender();
    installPurchaseGuards();

    const container = document.getElementById(containerId);

    if (!container) throw new Error('Checkout container is unavailable.');

    cancelWarehouseInitialization();

    const attempt = Symbol('warehouse-initialization');

    initializations.set(container, attempt);

    const current = () => initializations.get(container) === attempt;
    const recoveryRequired = () => {
        try {
            return getWarehouseCheckout()?.cartId === props.checkoutId && submissionNeedsReview();
        } catch {
            // Missing or invalid initialization stays blocked by the ordinary authorization screen.
            return false;
        }
    };
    const message = (failed: boolean, error?: unknown) => {
        if (!current()) return;
        unmountComponentAtNode(container);

        const recovery = recoveryRequired();
        const notice = document.createElement('div');

        const failureMessage =
            error instanceof RecoveryUnavailableError || error instanceof WarehouseInventoryConflict
                ? error.message
                : 'Warehouse checkout is unavailable. Return to your cart and try again.';

        notice.setAttribute('role', failed || recovery ? 'alert' : 'status');
        notice.setAttribute('data-test', 'warehouse-initialization');
        notice.textContent = recovery
            ? RECOVERY_MESSAGE
            : failed
              ? failureMessage
              : 'Verifying your warehouse and inventory…';
        container.replaceChildren(notice);

        if (failed && !recovery && warehouseInitializationEndpoint()) {
            const retry = document.createElement('button');

            retry.type = 'button';

            const stockConflict = error instanceof WarehouseInventoryConflict;

            retry.textContent = stockConflict
                ? 'Retry verification'
                : 'Retry warehouse authorization';

            retry.onclick = () => {
                if (!current()) return;
                delete window.warehouseCheckout;

                if (stockConflict) {
                    // Open the authenticated storefront popup inside this user gesture.
                    initialize(true, error.message);

                    return;
                }

                renderCheckout({ containerId, publicPath, ...props });
            };

            container.appendChild(retry);
        }
    };
    const mount = (freshCheckout = false, resolvedStockWarning?: string) => {
        if (!current()) return;

        // A persisted hint or a recovery event during validation must not mount payment UI.
        if (recoveryRequired()) {
            message(true);

            return;
        }

        // Recheck after async validation, including cart binding and expiry.
        const warehouseConfig = getWarehouseCheckout();

        if (warehouseConfig) validateWarehouseCheckout(warehouseConfig, props.checkoutId);

        const configuredPublicPath = configurePublicPath(publicPath);
        // Set the asset path before importing the application and its dependencies.
        const { default: CheckoutApp } = require('./CheckoutApp');

        render(
            <CheckoutApp
                containerId={containerId}
                publicPath={configuredPublicPath}
                {...props}
                initialState={freshCheckout ? undefined : props.initialState}
                resolvedStockWarning={resolvedStockWarning}
            />,
            container,
        );
    };

    const initialize = (fromRetryClick: boolean, resolvedStockWarning?: string) => {
        message(false);
        // Initialization uses the storefront session; server validation must
        // succeed before importing SDK checkout or payment recovery code.
        void initializeWarehouseCheckout(container, props.checkoutId, current, fromRetryClick)
            .then(async () => {
                if (!current()) throw new Error('Authorization was superseded.');
                if (recoveryRequired()) throw new Error(RECOVERY_MESSAGE);
                await validateCurrentWarehouse();
                if (current() && fromRetryClick) await restorePickupReview();
            })
            // Initial HTML can contain a stock error recorded before the successful retry.
            .then(() => mount(fromRetryClick, resolvedStockWarning))
            .catch((error: unknown) => message(true, error));
    };

    try {
        showLocalCheckoutNotice(container);

        if (getWarehouseDeployment().mode !== 'off') {
            initialize(false);
        } else {
            mount();
        }
    } catch {
        message(true);
    }
}
