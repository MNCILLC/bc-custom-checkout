import { type Consignment } from '@bigcommerce/checkout-sdk';

// Native pickup is identified by the SDK consignment, independently of store IDs.
export default function isWarehousePickup(consignments: Consignment[]): boolean {
    return (
        consignments.length === 1 && (consignments[0].selectedPickupOption?.pickupMethodId ?? 0) > 0
    );
}
