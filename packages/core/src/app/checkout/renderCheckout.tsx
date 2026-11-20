import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';

import { configurePublicPath } from '../common/bundler';
import { getWarehouseCheckout, validateWarehouseCheckout } from '../warehouse/config';
import { getWarehouseDeployment } from '../warehouse/deployment';
import {
    cancelWarehouseInitialization,
    initializeWarehouseCheckout,
    warehouseInitializationEndpoint,
} from '../warehouse/initialization';
import { showLocalCheckoutNotice } from '../warehouse/local-navigation';
import { installPurchaseGuards } from '../warehouse/purchaseGuards';
import { RECOVERY_MESSAGE, submissionNeedsReview } from '../warehouse/recovery';
import { RecoveryUnavailableError, validateCurrentWarehouse } from '../warehouse/validation';

import { type CheckoutAppProps } from './CheckoutApp';
import { initWhyDidYouRender } from './wdyr';

export type RenderCheckoutOptions = CheckoutAppProps;
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
            error instanceof RecoveryUnavailableError
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
            retry.textContent = 'Retry warehouse authorization';

            retry.onclick = () => {
                delete window.warehouseCheckout;
                renderCheckout({ containerId, publicPath, ...props });
            };

            container.appendChild(retry);
        }
    };
    const mount = () => {
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
            <CheckoutApp containerId={containerId} publicPath={configuredPublicPath} {...props} />,
            container,
        );
    };

    try {
        showLocalCheckoutNotice(container);

        if (getWarehouseDeployment().mode !== 'off') {
            message(false);
            // Initialization uses the storefront session; server validation must
            // succeed before importing SDK checkout or payment recovery code.
            void initializeWarehouseCheckout(container, props.checkoutId, current)
                .then(async () => {
                    if (!current()) throw new Error('Authorization was superseded.');
                    if (recoveryRequired()) throw new Error(RECOVERY_MESSAGE);
                    await validateCurrentWarehouse();
                })
                .then(mount)
                .catch((error: unknown) => message(true, error));
        } else {
            mount();
        }
    } catch {
        message(true);
    }
}
