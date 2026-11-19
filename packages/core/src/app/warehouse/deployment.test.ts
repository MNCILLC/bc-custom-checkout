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
        expect(() => readWarehouseDeployment('staging', local)).toThrow();
        expect(() =>
            readWarehouseDeployment(
                'development',
                local.replaceAll('localhost:3000', 'evil.example'),
            ),
        ).toThrow();
        Object.assign(process.env, { NODE_ENV: 'production' });
        expect(() => readWarehouseDeployment('development', local)).toThrow();
    } finally {
        Object.assign(process.env, { NODE_ENV: original });
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
