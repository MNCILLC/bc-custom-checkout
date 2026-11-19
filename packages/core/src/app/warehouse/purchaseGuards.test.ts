import { type WarehouseCheckoutConfig } from './config';
import * as deployment from './deployment';
import { installPurchaseGuards } from './purchaseGuards';

jest.mock('./deployment', () => ({ getWarehouseDeployment: jest.fn() }));

const config: WarehouseCheckoutConfig = {
    version: 1,
    preview: true,
    cartId: 'synthetic-cart',
    validation: {
        endpoint: 'https://warehouse.example/validate',
        token: 'synthetic-token',
        revision: 'synthetic-revision',
        expiresAt: 9999999999,
    },
    warehouse: {
        id: 'origin',
        label: 'Origin',
        pickupLabel: 'Origin pickup',
        locationId: 1,
        pickupMethodId: 2,
        allowShipping: true,
    },
};

let removeGuards: (() => void) | undefined;
let form: HTMLFormElement;
let control: HTMLElement;

beforeEach(() => {
    jest.mocked(deployment.getWarehouseDeployment).mockReturnValue({
        mode: 'staging',
        stores: [
            {
                checkoutOrigin: window.location.origin,
                validationEndpoint: config.validation.endpoint,
            },
        ],
    });
    window.warehouseCheckout = JSON.parse(JSON.stringify(config)) as WarehouseCheckoutConfig;
    form = document.createElement('form');
    form.dataset.warehouseValidatedSubmit = 'true';
    control = document.createElement('button');
    control.id = 'checkout-payment-continue';
    control.setAttribute('type', 'submit');
    form.appendChild(control);
    document.body.appendChild(form);
    removeGuards = installPurchaseGuards();
});

afterEach(() => {
    removeGuards?.();
    form.remove();
    delete window.warehouseCheckout;
    jest.restoreAllMocks();
});

it.each(['click', 'submit'])(
    'allows the opted-in standard form %s to reach React validation',
    (type) => {
        const reactHandler = jest.fn((event: Event) => event.preventDefault());

        form.addEventListener(type, reactHandler);

        const target = type === 'submit' ? form : control;

        target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        expect(reactHandler).toHaveBeenCalledTimes(1);
    },
);

it.each([
    'unmarked form',
    'provider widget',
    'custom button',
    'missing initialization',
    'expired initialization',
    'invalid initialization',
])('continues to block %s before provider handlers run', (scenario) => {
    if (scenario === 'unmarked form') delete form.dataset.warehouseValidatedSubmit;

    if (scenario === 'provider widget') {
        control.remove();
        control = document.createElement('div');
        control.id = 'checkout-payment-continue';
        form.appendChild(control);
    }

    if (scenario === 'custom button') control.setAttribute('type', 'button');
    if (scenario === 'missing initialization') delete window.warehouseCheckout;
    if (scenario === 'expired initialization' && window.warehouseCheckout)
        window.warehouseCheckout.validation.expiresAt = 1;
    if (scenario === 'invalid initialization' && window.warehouseCheckout)
        window.warehouseCheckout.validation.token = '';

    const providerHandler = jest.fn();

    form.addEventListener('click', providerHandler);
    form.addEventListener('submit', providerHandler);

    const child = document.createElement('span');

    control.appendChild(child);

    const click = new Event('click', { bubbles: true, cancelable: true });
    const submit = new Event('submit', { bubbles: true, cancelable: true });

    child.dispatchEvent(click);
    form.dispatchEvent(submit);
    expect(click.defaultPrevented).toBe(true);
    expect(submit.defaultPrevented).toBe(true);
    expect(providerHandler).not.toHaveBeenCalled();
});

it('leaves ordinary non-warehouse checkout unchanged', () => {
    jest.mocked(deployment.getWarehouseDeployment).mockReturnValue({ mode: 'off', stores: [] });
    delete window.warehouseCheckout;
    delete form.dataset.warehouseValidatedSubmit;

    const handler = jest.fn((event: Event) => event.preventDefault());

    form.addEventListener('submit', handler);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(handler).toHaveBeenCalledTimes(1);
});
