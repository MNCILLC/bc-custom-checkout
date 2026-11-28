import {
    assertCheckTestPayment,
    canSubmitCheckTest,
    checkTestAuthorization,
    type CheckTestClaim,
} from './checkTest';
import { getWarehouseCheckout } from './config';
import { getWarehouseDeployment } from './deployment';
import {
    type PaymentClaim,
    paymentGrants,
    selectedPaymentGrant,
    type WarehousePaymentSelection,
} from './paymentAuthorization';
import { markSubmissionAttempt } from './recovery';
import {
    assertTestProviderPayment,
    canSubmitTestProvider,
    testProviderAuthorization,
    type TestProviderClaim,
} from './testProvider';

export function canSubmitTestPayment() {
    const grants = paymentGrants();

    if (grants) return grants.length > 0;

    const check = canSubmitCheckTest();
    const card = canSubmitTestProvider();

    if (check && card) {
        const deployment = getWarehouseDeployment();

        return (
            deployment.mode === 'development' ||
            deployment.stores.some(
                (store) =>
                    store.checkoutOrigin === window.location.origin &&
                    store.allowHostedSandboxCheck,
            )
        );
    }

    return check || card;
}

export function assertTestPayment(payment: WarehousePaymentSelection | undefined) {
    const grants = paymentGrants();

    if (grants) {
        selectedPaymentGrant(grants, payment);

        return;
    }

    if (!canSubmitTestPayment())
        throw new Error('One explicit test payment authorization is required.');

    if (canSubmitCheckTest() && (payment?.methodId === 'cheque' || !canSubmitTestProvider())) {
        assertCheckTestPayment(payment);

        return;
    }

    assertTestProviderPayment(payment);
}

export type PaymentAttempt =
    | { payment: PaymentClaim; checkTest?: never; testProvider?: never }
    | { checkTest: CheckTestClaim; testProvider?: never; payment?: never }
    | { testProvider: TestProviderClaim; checkTest?: never; payment?: never };

export function beginTestPaymentAttempt(
    payment: WarehousePaymentSelection | undefined,
): PaymentAttempt {
    assertTestPayment(payment);

    const config = getWarehouseCheckout();
    const grants = paymentGrants();

    if (config && grants) {
        const { methodId, gatewayId, token } = selectedPaymentGrant(grants, payment);

        markSubmissionAttempt(config);

        return {
            payment: {
                methodId,
                gatewayId,
                token,
                usesStoredInstrument: false,
                shouldSaveInstrument: false,
            },
        };
    }

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
