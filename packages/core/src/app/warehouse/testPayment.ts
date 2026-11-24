import {
    assertCheckTestPayment,
    beginCheckTestAttempt,
    canSubmitCheckTest,
    type CheckTestPayment,
} from './checkTest';
import { getWarehouseDeployment } from './deployment';
import {
    assertTestProviderPayment,
    beginTestProviderAttempt,
    canSubmitTestProvider,
} from './testProvider';

export function canSubmitTestPayment() {
    const check = canSubmitCheckTest();
    const card = canSubmitTestProvider();

    if (check && card) return getWarehouseDeployment().mode === 'development';

    return check || card;
}

export function assertTestPayment(payment: CheckTestPayment | undefined) {
    if (!canSubmitTestPayment())
        throw new Error('One explicit test payment authorization is required.');

    if (canSubmitCheckTest() && (payment?.methodId === 'cheque' || !canSubmitTestProvider())) {
        assertCheckTestPayment(payment);

        return;
    }

    assertTestProviderPayment(payment);
}

export function beginTestPaymentAttempt(payment: CheckTestPayment | undefined) {
    assertTestPayment(payment);

    return payment?.methodId === 'cheque'
        ? { checkTest: beginCheckTestAttempt(payment), testProvider: undefined }
        : { testProvider: beginTestProviderAttempt(payment), checkTest: undefined };
}
