export type CloudLogSeverity = 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'ALERT' | 'EMERGENCY' | 'DEFAULT';

export interface CloudLogEntry {
  severity: CloudLogSeverity;
  event: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface CloudLoggerDeps {
  isCloudLoggingEnabled: () => boolean;
  getBackendUrl: () => string;
  sendBatch: (backendUrl: string, entries: CloudLogEntry[]) => Promise<void>;
  writeLocal: (entry: CloudLogEntry) => void;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  now?: () => Date;
}

export const MAX_BATCH_SIZE = 10;
export const FLUSH_INTERVAL_MS = 5_000;

export function normalizeSeverity(severity: string): CloudLogSeverity {
  const normalized = severity.trim().toUpperCase();
  const allowed: CloudLogSeverity[] = ['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY', 'DEFAULT'];
  return allowed.includes(normalized as CloudLogSeverity) ? normalized as CloudLogSeverity : 'DEFAULT';
}

export class CloudLogger {
  private queue: CloudLogEntry[] = [];
  private flushInterval: ReturnType<typeof globalThis.setInterval> | null = null;
  private activeFlush: Promise<void> | null = null;
  private isShuttingDown = false;

  constructor(private readonly deps: CloudLoggerDeps) {}

  cloudLog(severity: string, event: string, metadata: Record<string, unknown> = {}): void {
    const entry: CloudLogEntry = {
      severity: normalizeSeverity(severity),
      event,
      metadata,
      timestamp: (this.deps.now?.() ?? new Date()).toISOString(),
    };

    if (!this.deps.isCloudLoggingEnabled()) {
      this.deps.writeLocal(entry);
      return;
    }

    const backendUrl = this.deps.getBackendUrl().trim();
    if (!backendUrl) {
      this.deps.writeLocal({
        ...entry,
        metadata: {
          ...entry.metadata,
          cloudLoggingReason: 'missing_backend_url',
        },
      });
      return;
    }

    this.queue.push(entry);

    if (this.queue.length >= MAX_BATCH_SIZE) {
      void this.flush();
      return;
    }

    this.ensureFlushInterval();
  }

  async flush(): Promise<void> {
    if (this.activeFlush) {
      return this.activeFlush;
    }

    if (this.queue.length === 0) {
      this.clearFlushInterval();
      return;
    }

    const backendUrl = this.deps.getBackendUrl().trim();
    if (!backendUrl) {
      const pending = this.queue.splice(0, this.queue.length);
      pending.forEach((entry) => this.deps.writeLocal({
        ...entry,
        metadata: {
          ...entry.metadata,
          cloudLoggingReason: 'missing_backend_url',
        },
      }));
      return;
    }

    const entries = this.queue.splice(0, MAX_BATCH_SIZE);
    this.activeFlush = this.deps.sendBatch(backendUrl, entries)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        entries.forEach((entry) => this.deps.writeLocal({
          ...entry,
          metadata: {
            ...entry.metadata,
            cloudLoggingWriteFailed: true,
            cloudLoggingError: message,
          },
        }));
      })
      .finally(() => {
        this.activeFlush = null;
        if (this.queue.length > 0 && !this.isShuttingDown) {
          this.ensureFlushInterval();
        } else if (this.queue.length === 0) {
          this.clearFlushInterval();
        }
      });

    return this.activeFlush;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.clearFlushInterval();
    while (this.queue.length > 0 || this.activeFlush) {
      await this.flush();
      if (!this.activeFlush && this.queue.length === 0) {
        break;
      }
    }
  }

  private ensureFlushInterval(): void {
    if (this.flushInterval || this.isShuttingDown) {
      return;
    }

    this.flushInterval = this.deps.setInterval(() => {
      if (this.isShuttingDown || this.activeFlush || this.queue.length === 0) {
        if (!this.isShuttingDown && this.queue.length === 0) {
          this.clearFlushInterval();
        }
        return;
      }

      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private clearFlushInterval(): void {
    if (this.flushInterval) {
      this.deps.clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}
