import { readWarehouseDeployment } from './deployment';

const stores = [
    {
        checkoutOrigin: 'https://checkout-a.example',
        validationEndpoint: 'https://store-a.example/api/warehouse/validate',
    },
    {
        checkoutOrigin: 'https://checkout-b.example',
        validationEndpoint: 'https://store-b.example/api/warehouse/validate',
    },
];

it('defaults to off and supports two stores without source changes', () => {
    expect(readWarehouseDeployment().mode).toBe('off');
    expect(readWarehouseDeployment('staging', JSON.stringify(stores))).toEqual({
        mode: 'staging',
        stores,
    });
});
it.each([
    ['production', '[]'],
    ['staging', '[]'],
    ['staging', 'null'],
    ['staging', '{'],
    ['staging', JSON.stringify([stores[0], stores[0]])],
    ['staging', JSON.stringify([{ ...stores[0], checkoutOrigin: 'http://checkout-a.example' }])],
    [
        'staging',
        JSON.stringify([
            { ...stores[0], validationEndpoint: 'https://user:secret@example.com/validate' },
        ]),
    ],
    [
        'staging',
        JSON.stringify([
            { ...stores[0], validationEndpoint: 'https://store-a.example/validate?token=secret' },
        ]),
    ],
])('rejects invalid deployment configuration', (mode, config) => {
    expect(() => readWarehouseDeployment(mode, config)).toThrow(
        'Invalid warehouse checkout deployment configuration.',
    );
});

it('validates the optional standalone initialization endpoint', () => {
    const configured = [
        {
            ...stores[0],
            initializationEndpoint: 'https://store-a.example/en/warehouse-initialize/',
        },
    ];

    expect(readWarehouseDeployment('staging', JSON.stringify(configured)).stores).toEqual(
        configured,
    );

    for (const endpoint of [
        'http://store-a.example/init',
        'https://user:password@store-a.example/init',
        'https://store-a.example/init?token=value',
        'https://store-a.example/init#value',
    ]) {
        expect(() =>
            readWarehouseDeployment(
                'staging',
                JSON.stringify([{ ...stores[0], initializationEndpoint: endpoint }]),
            ),
        ).toThrow();
    }
});

it('permits localhost endpoints only in development mode and rejects production use', () => {
    const original = process.env.NODE_ENV;
    const local = JSON.stringify([
        {
            ...stores[0],
            validationEndpoint: 'http://localhost:3000/api/warehouse/validate',
            initializationEndpoint: 'http://localhost:3000/warehouse-initialize/',
        },
    ]);

    try {
        Object.assign(process.env, { NODE_ENV: 'development' });
        expect(readWarehouseDeployment('development', local).mode).toBe('development');

        const optedIn = JSON.stringify([{ ...JSON.parse(local)[0], allowTestProvider: true }]);

        expect(readWarehouseDeployment('development', optedIn).stores[0].allowTestProvider).toBe(
            true,
        );
        expect(() =>
            readWarehouseDeployment(
                'development',
                optedIn.replaceAll('http://localhost:3000', 'https://remote.example'),
            ),
        ).toThrow();

        const both = JSON.stringify([{ ...JSON.parse(optedIn)[0], allowCheckTest: true }]);

        expect(readWarehouseDeployment('development', both).stores[0]).toMatchObject({
            allowCheckTest: true,
            allowTestProvider: true,
        });
        expect(() =>
            readWarehouseDeployment(
                'development',
                both.replaceAll('http://localhost:3000', 'https://remote.example'),
            ),
        ).toThrow();
        expect(() => readWarehouseDeployment('staging', local)).toThrow();
        expect(() =>
            readWarehouseDeployment(
                'development',
                local.replaceAll('localhost:3000', 'evil.example'),
            ),
        ).toThrow();
        Object.assign(process.env, { NODE_ENV: 'production' });
        expect(() => readWarehouseDeployment('development', local)).toThrow();
        expect(() => readWarehouseDeployment('development', optedIn)).toThrow();
    } finally {
        Object.assign(process.env, { NODE_ENV: original });
    }
});

it('enables hosted one-click only for an explicitly configured store', () => {
    const identity = {
        currentCustomerClientId: 'example-app',
        handoffEndpoint: 'https://store-a.example/api/warehouse/initialize',
    };
    const enabled = { ...stores[0], ...identity, oneClickEnabled: true };
    const read = (store: object) =>
        readWarehouseDeployment('staging', JSON.stringify([store])).stores[0];

    expect(read(enabled)).toEqual(enabled);
    expect(read({ ...stores[0], ...identity })).toEqual(stores[0]);
    expect(read({ ...enabled, oneClickEnabled: false })).toEqual(stores[0]);
    expect(() => read({ ...enabled, oneClickEnabled: 'true' })).toThrow();
    expect(() => read({ ...enabled, currentCustomerClientId: undefined })).toThrow();
    expect(() => read({ ...enabled, handoffEndpoint: undefined })).toThrow();
    expect(() => read({ ...enabled, handoffEndpoint: 'https://other.example/init' })).toThrow();

    for (const base of [
        'http://store-a.example',
        'https://localhost',
        'https://127.0.0.1',
        'https://[::1]',
    ]) {
        expect(() =>
            read({
                ...enabled,
                handoffEndpoint: `${base}/init`,
                validationEndpoint: `${base}/validate`,
            }),
        ).toThrow();
    }
});

it('allows freight only on the store validator backend origin', () => {
    expect(
        readWarehouseDeployment(
            'staging',
            JSON.stringify([{ ...stores[0], freightEndpoint: 'https://store-a.example/freight' }]),
        ).stores[0].freightEndpoint,
    ).toBe('https://store-a.example/freight');
    expect(() =>
        readWarehouseDeployment(
            'staging',
            JSON.stringify([{ ...stores[0], freightEndpoint: 'https://other.example/freight' }]),
        ),
    ).toThrow();
});

it('Check-only execution needs an explicit per-store staging opt-in', () => {
    expect(
        readWarehouseDeployment('staging', JSON.stringify(stores)).stores[0].allowCheckTest,
    ).toBeUndefined();
    expect(
        readWarehouseDeployment('staging', JSON.stringify([{ ...stores[0], allowCheckTest: true }]))
            .stores[0].allowCheckTest,
    ).toBe(true);
    expect(() =>
        readWarehouseDeployment(
            'staging',
            JSON.stringify([{ ...stores[0], allowCheckTest: 'true' }]),
        ),
    ).toThrow();
});

it('requires an explicit Sandbox Cowboy opt-in to combine both methods in staging', () => {
    const sandbox = {
        checkoutOrigin: 'https://sandboxcatalystcheckout.mncillc.com',
        validationEndpoint: 'https://sandboxcatalyst.mncillc.com/api/warehouse/validate',
        allowCheckTest: true,
        allowTestProvider: true,
        allowHostedSandboxCheck: true,
    };

    expect(readWarehouseDeployment('staging', JSON.stringify([sandbox, stores[0]])).stores).toEqual(
        [sandbox, stores[0]],
    );

    for (const change of [
        { allowHostedSandboxCheck: undefined },
        { allowHostedSandboxCheck: false },
        { allowHostedSandboxCheck: 'true' },
        { allowTestProvider: false },
        { allowCheckTest: false },
        { checkoutOrigin: stores[0].checkoutOrigin },
        { validationEndpoint: stores[0].validationEndpoint },
    ]) {
        expect(() =>
            readWarehouseDeployment('staging', JSON.stringify([{ ...sandbox, ...change }])),
        ).toThrow();
    }
});

it('allows an individual staging payment opt-in independently', () => {
    const stores = [
        {
            checkoutOrigin: 'https://checkout.example',
            validationEndpoint: 'https://backend.example/validate',
        },
    ];

    expect(
        readWarehouseDeployment('staging', JSON.stringify(stores)).stores[0].allowTestProvider,
    ).toBeUndefined();
    expect(
        readWarehouseDeployment(
            'staging',
            JSON.stringify([{ ...stores[0], allowTestProvider: true }]),
        ).stores[0].allowTestProvider,
    ).toBe(true);
    for (const config of [
        { allowTestProvider: 'true' },
        { allowTestProvider: true, allowCheckTest: true },
    ])
        expect(() =>
            readWarehouseDeployment('staging', JSON.stringify([{ ...stores[0], ...config }])),
        ).toThrow();
});
