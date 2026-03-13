import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudLogger,
  FLUSH_INTERVAL_MS,
  MAX_BATCH_SIZE,
  normalizeSeverity,
  type CloudLogEntry,
  type CloudLoggerDeps,
} from '../../../../electron/main/services/cloudLoggerCore.ts';

function createDeps(overrides?: Partial<CloudLoggerDeps>) {
  const localEntries: CloudLogEntry[] = [];
  const sendBatch = vi.fn(async () => undefined);
  const writeLocal = vi.fn((entry: CloudLogEntry) => {
    localEntries.push(entry);
  });

  const deps: CloudLoggerDeps = {
    isCloudLoggingEnabled: () => true,
    getBackendUrl: () => 'https://backend.example',
    sendBatch,
    writeLocal,
    setInterval,
    clearInterval,
    now: () => new Date('2026-03-13T12:00:00.000Z'),
    ...overrides,
  };

  return { deps, localEntries, sendBatch, writeLocal };
}

describe('CloudLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('normalizes severities defensively', () => {
    expect(normalizeSeverity(' error ')).toBe('ERROR');
    expect(normalizeSeverity('unexpected')).toBe('DEFAULT');
  });

  it('flushes immediately when the queue reaches the batch threshold', async () => {
    const { deps, sendBatch } = createDeps();
    const logger = new CloudLogger(deps);

    for (let index = 0; index < MAX_BATCH_SIZE; index += 1) {
      logger.cloudLog('info', `event-${index}`);
    }

    await logger.flush();
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]?.[1]).toHaveLength(MAX_BATCH_SIZE);
  });

  it('flushes queued entries on the periodic interval', async () => {
    const { deps, sendBatch } = createDeps();
    const logger = new CloudLogger(deps);

    logger.cloudLog('info', 'interval-event');
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('falls back to local logging when no backend URL is configured', () => {
    const { deps, localEntries, sendBatch } = createDeps({
      getBackendUrl: () => '',
    });
    const logger = new CloudLogger(deps);

    logger.cloudLog('warning', 'missing-backend');

    expect(sendBatch).not.toHaveBeenCalled();
    expect(localEntries).toHaveLength(1);
    expect(localEntries[0]?.metadata.cloudLoggingReason).toBe('missing_backend_url');
  });

  it('drains the queue on shutdown even before the interval fires', async () => {
    const { deps, sendBatch } = createDeps();
    const logger = new CloudLogger(deps);

    logger.cloudLog('info', 'pending-event');
    await logger.shutdown();

    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('writes failed batches to local logging with failure metadata', async () => {
    const { deps, localEntries } = createDeps({
      sendBatch: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const logger = new CloudLogger(deps);

    logger.cloudLog('error', 'failed-batch');
    await logger.flush();

    expect(localEntries).toHaveLength(1);
    expect(localEntries[0]?.metadata.cloudLoggingWriteFailed).toBe(true);
    expect(localEntries[0]?.metadata.cloudLoggingError).toBe('network down');
  });
});
