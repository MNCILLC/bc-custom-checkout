export interface SubmissionAttempt<T> {
    prepare(): Promise<boolean>;
    refresh(): Promise<void>;
    fingerprint(): string;
    validate(): Promise<void>;
    execute(): Promise<T>;
}

// One instance per checkout tab. Deliberately does not claim cross-tab exclusion.
export function createSubmissionGuard(onBusy: (busy: boolean) => void = () => undefined) {
    let busy = false;

    return async function submit<T>(attempt: SubmissionAttempt<T>): Promise<T | undefined> {
        if (busy) throw new Error('Checkout verification is already in progress. Please wait.');

        busy = true;
        onBusy(true);

        try {
            if (!(await attempt.prepare())) return;

            const reviewed = attempt.fingerprint();

            await attempt.refresh();

            if (attempt.fingerprint() !== reviewed)
                throw new Error('Checkout changed. Review your checkout before retrying.');

            await attempt.validate();

            if (attempt.fingerprint() !== reviewed)
                throw new Error('Checkout changed during verification. Review it before retrying.');

            // A remote change after validation is still possible. This is not atomic.
            return await attempt.execute();
        } finally {
            busy = false;
            onBusy(false);
        }
    };
}
