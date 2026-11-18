import { type Consignment } from '@bigcommerce/checkout-sdk';
import { every } from 'lodash';

import { warehouseConsignmentsValid } from '../warehouse/config';

import isWarehousePickup from './isWarehousePickup';

export default function hasSelectedShippingOptions(consignments: Consignment[]): boolean {
    if (!consignments.length || !warehouseConsignmentsValid(consignments)) {
        return false;
    }

    if (isWarehousePickup(consignments)) {
        return true;
    }

    return every(
        consignments,
        (consignment) =>
            (consignment.selectedShippingOption && consignment.selectedShippingOption.id) ||
            consignment.selectedShippingOption?.type === 'custom',
    );
}
