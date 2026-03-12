import { Logging } from '@google-cloud/logging';

const LOG_NAME = 'sally-agent-log';
const CLOUD_LOGGING_ENABLED = process.env.ENABLE_CLOUD_LOGGING === 'true';

let loggingClient = null;
let loggingHandle = null;

function normalizeSeverity(severity) {
  const normalized = typeof severity === 'string' ? severity.trim().toUpperCase() : 'DEFAULT';
  const allowed = new Set([
    'DEFAULT',
    'DEBUG',
    'INFO',
    'NOTICE',
    'WARNING',
    'ERROR',
    'CRITICAL',
    'ALERT',
    'EMERGENCY',
  ]);

  return allowed.has(normalized) ? normalized : 'DEFAULT';
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
}

function writeConsoleLog(severity, message, metadata) {
  const payload = {
    severity,
    message,
    ...metadata,
  };

  console.log(JSON.stringify(payload));
}

function getLoggingHandle() {
  if (!CLOUD_LOGGING_ENABLED) {
    return null;
  }

  if (loggingHandle) {
    return loggingHandle;
  }

  loggingClient = new Logging();
  loggingHandle = loggingClient.log(LOG_NAME);
  return loggingHandle;
}

export async function log(severity, message, metadata = {}) {
  const normalizedSeverity = normalizeSeverity(severity);
  const normalizedMetadata = normalizeMetadata(metadata);

  if (!CLOUD_LOGGING_ENABLED) {
    writeConsoleLog(normalizedSeverity, message, normalizedMetadata);
    return;
  }

  try {
    const handle = getLoggingHandle();
    if (!handle) {
      writeConsoleLog(normalizedSeverity, message, normalizedMetadata);
      return;
    }

    const entry = handle.entry(
      {
        severity: normalizedSeverity,
      },
      {
        message,
        ...normalizedMetadata,
      },
    );

    await handle.write(entry);
  } catch (error) {
    const loggingError = error instanceof Error ? error.message : String(error);
    writeConsoleLog(normalizedSeverity, message, {
      ...normalizedMetadata,
      cloudLoggingWriteFailed: true,
      cloudLoggingError: loggingError,
    });
  }
}

export { CLOUD_LOGGING_ENABLED as cloudLoggingEnabled, LOG_NAME };
