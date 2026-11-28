// Shared by webpack and checkout runtime. Contains public routing policy only.
function httpsUrl(value, originOnly, local = false) {
    if (typeof value !== 'string') throw new Error('Invalid URL');

    const url = new URL(value);

    if (
        (url.protocol !== 'https:' && !(local && url.origin === 'http://localhost:3000')) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (originOnly && url.origin !== value)
    )
        throw new Error('Invalid URL');

    return originOnly ? url.origin : url.href;
}

function oneClickSettings(store, mode) {
    const hosted = mode === 'staging';

    if (
        store.oneClickEnabled !== undefined &&
        (!hosted || typeof store.oneClickEnabled !== 'boolean')
    )
        throw new Error('Invalid hosted one-click opt-in');

    if (
        hosted
            ? !store.oneClickEnabled
            : store.currentCustomerClientId === undefined && store.handoffEndpoint === undefined
    )
        return {};

    const endpoint = new URL(httpsUrl(store.handoffEndpoint, false, !hosted));

    if (
        typeof store.currentCustomerClientId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(store.currentCustomerClientId) ||
        endpoint.origin !== new URL(store.validationEndpoint).origin ||
        (hosted && /(^|\.)localhost\.?$|^127\.|^\[::1\]$/i.test(endpoint.hostname))
    )
        throw new Error('Invalid one-click identity configuration');

    return {
        ...(hosted ? { oneClickEnabled: true } : {}),
        currentCustomerClientId: store.currentCustomerClientId,
        handoffEndpoint: endpoint.href,
    };
}

function readWarehouseDeployment(mode = 'off', encodedStores = '[]') {
    try {
        if (!['off', 'staging', 'development'].includes(mode)) throw new Error('Invalid mode');
        if (mode === 'development' && process.env.NODE_ENV !== 'development')
            throw new Error('Local checkout requires a development build');
        if (mode === 'off') return { mode, stores: [] };

        const input = JSON.parse(encodedStores);

        if (!Array.isArray(input) || !input.length) throw new Error('Missing stores');

        const stores = input.map((store) => {
            for (const optIn of [store.allowTestProvider, store.allowCheckTest]) {
                if (
                    optIn !== undefined &&
                    (typeof optIn !== 'boolean' ||
                        (mode === 'development' &&
                            optIn &&
                            new URL(store.validationEndpoint).origin !== 'http://localhost:3000'))
                )
                    throw new Error('Invalid test payment opt-in or local validation endpoint');
            }

            if (
                store.allowHostedSandboxCheck !== undefined &&
                typeof store.allowHostedSandboxCheck !== 'boolean'
            )
                throw new Error('Invalid hosted Sandbox Cowboy payment opt-in');
            if (
                store.allowHostedSandboxCheck &&
                (mode !== 'staging' ||
                    !store.allowCheckTest ||
                    !store.allowTestProvider ||
                    store.checkoutOrigin !== 'https://sandboxcatalystcheckout.mncillc.com' ||
                    store.validationEndpoint !==
                        'https://sandboxcatalyst.mncillc.com/api/warehouse/validate')
            )
                throw new Error(
                    'Shared hosted test payments require the Sandbox Cowboy checkout and validator',
                );
            if (
                mode === 'staging' &&
                store.allowTestProvider &&
                store.allowCheckTest &&
                !store.allowHostedSandboxCheck
            )
                throw new Error('Choose one test payment opt-in');

            const preview = store.localCardPreview;

            if (
                preview !== undefined &&
                (mode !== 'development' ||
                    !store.allowTestProvider ||
                    typeof preview?.methodId !== 'string' ||
                    !preview.methodId.length ||
                    preview.methodId.length > 128 ||
                    ['cheque', 'bigpaypay'].includes(preview.methodId) ||
                    typeof preview.gatewayId !== 'string' ||
                    !preview.gatewayId.length ||
                    preview.gatewayId.length > 128)
            )
                throw new Error('Invalid local card preview');

            return {
                ...(preview
                    ? { localCardPreview: { methodId: preview.methodId, gatewayId: preview.gatewayId } }
                    : {}),
                ...(store.allowTestProvider === true ? { allowTestProvider: true } : {}),
                ...(store.allowHostedSandboxCheck === true
                    ? { allowHostedSandboxCheck: true }
                    : {}),
                ...oneClickSettings(store, mode),
                ...(store.allowCheckTest === true ? { allowCheckTest: true } : {}),
                checkoutOrigin: httpsUrl(store.checkoutOrigin, true),
                validationEndpoint: httpsUrl(
                    store.validationEndpoint,
                    false,
                    mode === 'development',
                ),
                ...(store.freightEndpoint === undefined
                    ? {}
                    : {
                          freightEndpoint: httpsUrl(
                              store.freightEndpoint,
                              false,
                              mode === 'development',
                          ),
                      }),
                ...(store.initializationEndpoint === undefined
                    ? {}
                    : {
                          initializationEndpoint: httpsUrl(
                              store.initializationEndpoint,
                              false,
                              mode === 'development',
                          ),
                      }),
            };
        });

        if (
            stores.some(
                (store) =>
                    store.freightEndpoint &&
                    new URL(store.freightEndpoint).origin !==
                        new URL(store.validationEndpoint).origin,
            )
        )
            throw new Error('Freight and validation must use the same backend origin');

        if (new Set(stores.map((store) => store.checkoutOrigin)).size !== stores.length)
            throw new Error('Ambiguous checkout origin');

        return { mode, stores };
    } catch {
        throw new Error('Invalid warehouse checkout deployment configuration.');
    }
}

function getWarehouseDeployment() {
    return readWarehouseDeployment(
        process.env.WAREHOUSE_CHECKOUT_MODE,
        process.env.WAREHOUSE_CHECKOUT_STORES,
    );
}

module.exports = { readWarehouseDeployment, getWarehouseDeployment };
