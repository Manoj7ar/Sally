import { apiKeyManager } from '../managers/apiKeyManager.js';
import { store, STORE_KEYS } from '../utils/store.js';
import { mainLogger } from '../utils/logger.js';
import { CloudLogger } from './cloudLoggerCore.js';
export const cloudLogger = new CloudLogger({
  isCloudLoggingEnabled: () => Boolean(store.get(STORE_KEYS.CLOUD_LOGGING_ENABLED)),
  getBackendUrl: () => apiKeyManager.getGeminiBackendUrl(),
  sendBatch: async (backendUrl, entries) => {
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
  },
  writeLocal: (entry) => {
    mainLogger.info(JSON.stringify(entry));
  },
  setInterval,
  clearInterval,
});
export const cloudLog = cloudLogger.cloudLog.bind(cloudLogger);
export { CloudLogger, FLUSH_INTERVAL_MS, MAX_BATCH_SIZE, normalizeSeverity } from './cloudLoggerCore.js';
