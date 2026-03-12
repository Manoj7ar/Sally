import { apiKeyManager } from '../managers/apiKeyManager.js';
import { store, STORE_KEYS } from '../utils/store.js';

type CloudLogSeverity = 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'ALERT' | 'EMERGENCY' | 'DEFAULT';

interface CloudLogEntry {
  severity: CloudLogSeverity;
  event: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

const MAX_BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5_000;

function normalizeSeverity(severity: string): CloudLogSeverity {
  const normalized = severity.trim().toUpperCase();
  const allowed: CloudLogSeverity[] = ['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY', 'DEFAULT'];
  return allowed.includes(normalized as CloudLogSeverity) ? normalized as CloudLogSeverity : 'DEFAULT';
}

class CloudLogger {
  private queue: CloudLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private activeFlush: Promise<void> | null = null;
  private isShuttingDown = false;

  cloudLog(severity: string, event: string, metadata: Record<string, unknown> = {}): void {
    const entry: CloudLogEntry = {
      severity: normalizeSeverity(severity),
      event,
      metadata,
      timestamp: new Date().toISOString(),
    };

    if (!this.isCloudLoggingEnabled()) {
      this.writeLocal(entry);
      return;
    }

    const backendUrl = apiKeyManager.getGeminiBackendUrl().trim();
    if (!backendUrl) {
      this.writeLocal({
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

    this.ensureFlushTimer();
  }

  async flush(): Promise<void> {
    if (this.activeFlush) {
      return this.activeFlush;
    }

    if (this.queue.length === 0) {
      this.clearFlushTimer();
      return;
    }

    this.clearFlushTimer();

    const backendUrl = apiKeyManager.getGeminiBackendUrl().trim();
    if (!backendUrl) {
      const pending = this.queue.splice(0, this.queue.length);
      pending.forEach((entry) => this.writeLocal({
        ...entry,
        metadata: {
          ...entry.metadata,
          cloudLoggingReason: 'missing_backend_url',
        },
      }));
      return;
    }

    const entries = this.queue.splice(0, MAX_BATCH_SIZE);
    this.activeFlush = this.sendBatch(backendUrl, entries)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        entries.forEach((entry) => this.writeLocal({
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
          this.ensureFlushTimer();
        }
      });

    return this.activeFlush;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.clearFlushTimer();
    while (this.queue.length > 0 || this.activeFlush) {
      await this.flush();
      if (!this.activeFlush && this.queue.length === 0) {
        break;
      }
    }
  }

  private isCloudLoggingEnabled(): boolean {
    return Boolean(store.get(STORE_KEYS.CLOUD_LOGGING_ENABLED));
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer || this.isShuttingDown) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async sendBatch(backendUrl: string, entries: CloudLogEntry[]): Promise<void> {
    const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Cloud logging backend error: ${response.status} ${errorText}`);
    }
  }

  private writeLocal(entry: CloudLogEntry): void {
    console.log(JSON.stringify(entry));
  }
}

export const cloudLogger = new CloudLogger();
export const cloudLog = cloudLogger.cloudLog.bind(cloudLogger);
