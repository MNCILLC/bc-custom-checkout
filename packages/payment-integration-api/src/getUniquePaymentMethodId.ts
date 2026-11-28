import { compact } from 'lodash';

export default function getUniquePaymentMethodId(methodId: string, gatewayId?: string): string {
    if (methodId.includes('-') || gatewayId?.includes('-')) {
        const gateway = gatewayId || '';

        // The gateway length locates the separator even when either ID contains hyphens.
        return `pm--${gateway.length}-${gateway}-${methodId}`;
    }

    return compact([gatewayId, methodId]).join('-');
}
