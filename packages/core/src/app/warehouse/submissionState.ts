let busy = false;

export const warehouseSubmissionInProgress = () => busy;

export function setWarehouseSubmissionInProgress(value: boolean) {
    busy = value;
    window.dispatchEvent(new Event('warehouse-submission-state'));
}
