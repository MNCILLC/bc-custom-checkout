import { createContext } from 'react';

export const WarehouseShippingContext = createContext<
    | {
          freightReady: boolean;
          setAddressBusy(busy: boolean): void;
          setFreightActionsTarget?(element: HTMLDivElement | null): void;
      }
    | undefined
>(undefined);
