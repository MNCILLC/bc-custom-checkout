export interface WarehouseDeployment {
    mode: 'off' | 'staging' | 'development';
    stores: Array<{
        checkoutOrigin: string;
        oneClickEnabled?: boolean;
        currentCustomerClientId?: string;
        handoffEndpoint?: string;
        allowCheckTest?: boolean;
        allowHostedSandboxCheck?: boolean;
        allowTestProvider?: boolean;
        localCardPreview?: { methodId: string; gatewayId: string };
        validationEndpoint: string;
        initializationEndpoint?: string;
        freightEndpoint?: string;
    }>;
}
export function readWarehouseDeployment(mode?: string, encodedStores?: string): WarehouseDeployment;
export function getWarehouseDeployment(): WarehouseDeployment;
