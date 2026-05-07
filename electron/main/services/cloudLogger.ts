// Local structured logging only (no remote Google Cloud pipeline)
import { mainLogger } from '../utils/logger.js';

export type CloudLogSeverity =
  | 'DEBUG'
  | 'INFO'
  | 'NOTICE'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL'
  | 'ALERT'
  | 'EMERGENCY'
  | 'DEFAULT';

export interface CloudLogEntry {
  severity: CloudLogSeverity;
  event: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export function normalizeSeverity(severity: string): CloudLogSeverity {
  const normalized = severity.trim().toUpperCase();
  const allowed: CloudLogSeverity[] = [
    'DEBUG',
    'INFO',
    'NOTICE',
    'WARNING',
    'ERROR',
    'CRITICAL',
    'ALERT',
    'EMERGENCY',
    'DEFAULT',
  ];
  return allowed.includes(normalized as CloudLogSeverity) ? (normalized as CloudLogSeverity) : 'DEFAULT';
}

export function cloudLog(severity: string, event: string, metadata: Record<string, unknown> = {}): void {
  const entry: CloudLogEntry = {
    severity: normalizeSeverity(severity),
    event,
    metadata,
    timestamp: new Date().toISOString(),
  };
  mainLogger.info(JSON.stringify(entry));
}

export const cloudLogger = {
  cloudLog,
  shutdown: async (): Promise<void> => undefined,
};
