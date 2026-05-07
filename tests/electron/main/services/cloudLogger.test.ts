import { describe, expect, it, vi } from 'vitest';
import { mainLogger } from '../../../../electron/main/utils/logger.js';
import { cloudLog, normalizeSeverity } from '../../../../electron/main/services/cloudLogger.js';

describe('cloudLogger', () => {
  it('normalizeSeverity maps known severities', () => {
    expect(normalizeSeverity('info')).toBe('INFO');
    expect(normalizeSeverity('WARNING')).toBe('WARNING');
  });

  it('normalizeSeverity defaults unknown values', () => {
    expect(normalizeSeverity('nope')).toBe('DEFAULT');
  });

  it('cloudLog writes JSON to mainLogger', () => {
    const spy = vi.spyOn(mainLogger, 'info').mockImplementation(() => undefined);
    cloudLog('INFO', 'test_event', { foo: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(payload.event).toBe('test_event');
    expect(payload.severity).toBe('INFO');
    expect(payload.metadata).toEqual({ foo: 1 });
    spy.mockRestore();
  });
});
