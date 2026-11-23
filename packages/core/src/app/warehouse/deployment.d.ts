export interface WarehouseDeployment {
    mode: 'off' | 'staging' | 'development';
    stores: Array<{
        checkoutOrigin: string;
        oneClickEnabled?: boolean;
        currentCustomerClientId?: string;
        handoffEndpoint?: string;
        allowCheckTest?: boolean;
        allowTestProvider?: boolean;
        validationEndpoint: string;
        initializationEndpoint?: string;
        freightEndpoint?: string;
    }>;
}
export function readWarehouseDeployment(mode?: string, encodedStores?: string): WarehouseDeployment;
export function getWarehouseDeployment(): WarehouseDeployment;
