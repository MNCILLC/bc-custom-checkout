import { createSubmissionGuard } from './submissionGuard';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

function fixture() {
    let state = 'reviewed';
    const execute = jest.fn().mockResolvedValue('simulated-order');
    const attempt = {
        prepare: jest.fn().mockResolvedValue(true),
        refresh: jest.fn().mockResolvedValue(undefined),
        fingerprint: () => state,
        validate: jest.fn().mockResolvedValue(undefined),
        execute,
    };

    return {
        attempt,
        change: () => {
            state = 'changed';
        },
    };
}

it('prepares, refreshes, validates and executes in order', async () => {
    const events: string[] = [];
    const submit = createSubmissionGuard();

    await submit({
        prepare: async () => {
            events.push('save billing');

            return true;
        },
        refresh: async () => {
            events.push('refresh');
        },
        fingerprint: () => 'reviewed',
        validate: async () => {
            events.push('server validation');
        },
        execute: async () => {
            events.push('simulated submit');
        },
    });
    expect(events).toEqual(['save billing', 'refresh', 'server validation', 'simulated submit']);
});

it('stops for invalid billing or changed totals requiring review', async () => {
    const { attempt } = fixture();

    attempt.prepare.mockResolvedValue(false);
    await createSubmissionGuard()(attempt);
    expect(attempt.refresh).not.toHaveBeenCalled();
    expect(attempt.execute).not.toHaveBeenCalled();
});

it('rejects changed state discovered by refresh', async () => {
    const { attempt, change } = fixture();

    attempt.refresh.mockImplementation(async () => {
        change();
    });
    await expect(createSubmissionGuard()(attempt)).rejects.toThrow('Checkout changed');
    expect(attempt.validate).not.toHaveBeenCalled();
    expect(attempt.execute).not.toHaveBeenCalled();
});

it('rejects state changed while server verification is pending', async () => {
    const { attempt, change } = fixture();
    const pending = deferred();
    const started = deferred();

    attempt.validate.mockImplementation(async () => {
        started.resolve();
        await pending.promise;
    });

    const result = createSubmissionGuard()(attempt);

    await started.promise;
    change();
    pending.resolve();
    await expect(result).rejects.toThrow('during verification');
    expect(attempt.execute).not.toHaveBeenCalled();
});

it.each([
    'stale warehouse',
    'inventory conflict',
    'expired authorization',
    'timeout',
    'unavailable',
])('fails closed on %s and validates again on retry', async (reason) => {
    const { attempt } = fixture();
    const busy = jest.fn();
    const submit = createSubmissionGuard(busy);

    attempt.validate.mockRejectedValueOnce(new Error(reason));
    await expect(submit(attempt)).rejects.toThrow(reason);
    expect(attempt.execute).not.toHaveBeenCalled();
    await submit(attempt);
    expect(attempt.validate).toHaveBeenCalledTimes(2);
    expect(attempt.execute).toHaveBeenCalledTimes(1);
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
});

it('rejects double-clicks while preparing and while the executor is pending', async () => {
    const { attempt } = fixture();
    const prepare = deferred();
    const executing = deferred();
    const finish = deferred();
    const submit = createSubmissionGuard();

    attempt.prepare.mockImplementation(async () => {
        await prepare.promise;

        return true;
    });
    attempt.execute.mockImplementation(async () => {
        executing.resolve();
        await finish.promise;
    });

    const result = submit(attempt);

    await expect(submit(attempt)).rejects.toThrow('already in progress');
    prepare.resolve();
    await executing.promise;
    await expect(submit(attempt)).rejects.toThrow('already in progress');
    finish.resolve();
    await result;
    expect(attempt.execute).toHaveBeenCalledTimes(1);
});

it('documents that separate tabs can both reach their simulated executors', async () => {
    const { attempt } = fixture();

    await Promise.all([createSubmissionGuard()(attempt), createSubmissionGuard()(attempt)]);
    expect(attempt.execute).toHaveBeenCalledTimes(2);
});

it('documents the unprotected remote-change window after validation', async () => {
    const { attempt } = fixture();
    let remoteRevision = 'approved';

    attempt.execute.mockImplementation(async () => {
        // Remote state is not an observable local SDK state change.
        remoteRevision = 'changed-after-validation';

        return 'simulated-order';
    });
    await expect(createSubmissionGuard()(attempt)).resolves.toBe('simulated-order');
    expect(remoteRevision).toBe('changed-after-validation');
    expect(attempt.execute).toHaveBeenCalledTimes(1);
});
