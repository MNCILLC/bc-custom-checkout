export interface WarehouseDeployment {
    mode: 'off' | 'staging' | 'development';
    stores: Array<{
        checkoutOrigin: string;
        validationEndpoint: string;
        initializationEndpoint?: string;
    }>;
}
export function readWarehouseDeployment(mode?: string, encodedStores?: string): WarehouseDeployment;
export function getWarehouseDeployment(): WarehouseDeployment;
