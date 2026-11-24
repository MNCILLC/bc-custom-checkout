import {
    assertCheckTestPayment,
    canSubmitCheckTest,
    checkTestAuthorization,
    type CheckTestClaim,
    type CheckTestPayment,
} from './checkTest';
import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import { markSubmissionAttempt } from './recovery';
import {
    assertTestProviderPayment,
    canSubmitTestProvider,
    testProviderAuthorization,
    type TestProviderClaim,
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

export type PaymentAttempt =
    | { checkTest: CheckTestClaim; testProvider?: never }
    | { testProvider: TestProviderClaim; checkTest?: never };

export function beginTestPaymentAttempt(payment: CheckTestPayment | undefined): PaymentAttempt {
    assertTestPayment(payment);

    const config = getWarehouseCheckout();
    const grant =
        payment?.methodId === 'cheque' ? checkTestAuthorization() : testProviderAuthorization();

    if (!config || !grant || grant.methodId !== payment?.methodId)
        throw new Error('Payment authorization is unavailable for the selected method.');

    markSubmissionAttempt(config);

    const { token, methodId } = grant;

    return methodId === 'cheque'
        ? { checkTest: { token, methodId, gatewayId: null } }
        : {
              testProvider: {
                  token,
                  methodId,
                  gatewayId: null,
                  usesStoredInstrument: false,
                  shouldSaveInstrument: false,
              },
          };
}
