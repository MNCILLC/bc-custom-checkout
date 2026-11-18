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
import { validateCurrentWarehouse } from '../warehouse/validation';

import { type CheckoutAppProps } from './CheckoutApp';
import { initWhyDidYouRender } from './wdyr';

export type RenderCheckoutOptions = CheckoutAppProps;
export type RenderCheckout = typeof renderCheckout;

const initializations = new WeakMap<Element, symbol>();
let purchaseGuardsInstalled = false;

function installPurchaseGuards() {
    if (purchaseGuardsInstalled) return;
    purchaseGuardsInstalled = true;

    const blocked = () => {
        try {
            return getWarehouseDeployment().mode !== 'off' || !!window.warehouseCheckout;
        } catch {
            return true;
        }
    };

    document.addEventListener(
        'submit',
        (event) => {
            if (
                blocked() &&
                event.target instanceof Element &&
                event.target.querySelector('#checkout-payment-continue')
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        },
        true,
    );
    document.addEventListener(
        'click',
        (event) => {
            if (
                blocked() &&
                event.target instanceof Element &&
                event.target.closest('#checkout-payment-continue')
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        },
        true,
    );
}

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
    const message = (failed: boolean) => {
        if (!current()) return;
        unmountComponentAtNode(container);

        const notice = document.createElement('div');

        notice.setAttribute('role', failed ? 'alert' : 'status');
        notice.setAttribute('data-test', 'warehouse-initialization');
        notice.textContent = failed
            ? 'Warehouse checkout is unavailable. Return to your cart and try again.'
            : 'Verifying your warehouse and inventory…';
        container.replaceChildren(notice);

        if (failed && warehouseInitializationEndpoint()) {
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
                    await validateCurrentWarehouse();
                })
                .then(mount)
                .catch(() => message(true));
        } else {
            mount();
        }
    } catch {
        message(true);
    }
}
