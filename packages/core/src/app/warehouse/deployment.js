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

function readWarehouseDeployment(mode = 'off', encodedStores = '[]') {
    try {
        if (!['off', 'staging', 'development'].includes(mode)) throw new Error('Invalid mode');
        if (mode === 'development' && process.env.NODE_ENV !== 'development')
            throw new Error('Local checkout requires a development build');
        if (mode === 'off') return { mode, stores: [] };

        const input = JSON.parse(encodedStores);

        if (!Array.isArray(input) || !input.length) throw new Error('Missing stores');

        const stores = input.map((store) => ({
            checkoutOrigin: httpsUrl(store.checkoutOrigin, true),
            validationEndpoint: httpsUrl(store.validationEndpoint, false, mode === 'development'),
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
        }));

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
