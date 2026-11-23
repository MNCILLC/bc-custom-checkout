import type { Address } from '@bigcommerce/checkout-sdk/essential';
import { createContext } from 'react';

export const WarehouseShippingContext = createContext<
    | {
          freightReady: boolean;
          addressDuringFreightRefresh?: Address;
          setAddressBusy(busy: boolean): void;
          setFreightActionsTarget?(element: HTMLDivElement | null): void;
      }
    | undefined
>(undefined);
