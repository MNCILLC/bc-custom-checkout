import {
    assertCheckTestPayment,
    beginCheckTestAttempt,
    canSubmitCheckTest,
    type CheckTestPayment,
} from './checkTest';
import {
    assertTestProviderPayment,
    beginTestProviderAttempt,
    canSubmitTestProvider,
} from './testProvider';

export function canSubmitTestPayment() {
    return canSubmitCheckTest() !== canSubmitTestProvider();
}

export function assertTestPayment(payment: CheckTestPayment | undefined) {
    if (!canSubmitTestPayment())
        throw new Error('One explicit test payment authorization is required.');
    if (canSubmitTestProvider()) assertTestProviderPayment(payment);
    else assertCheckTestPayment(payment);
}

export function beginTestPaymentAttempt(payment: CheckTestPayment | undefined) {
    assertTestPayment(payment);

    return canSubmitTestProvider()
        ? { testProvider: beginTestProviderAttempt(payment), checkTest: undefined }
        : { checkTest: beginCheckTestAttempt(payment), testProvider: undefined };
}
