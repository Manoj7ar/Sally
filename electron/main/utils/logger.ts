import { app } from 'electron';

function isDebugLoggingEnabled(): boolean {
  return Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged || process.env.SALLY_DEBUG === '1';
}

function write(method: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  console[method](...args);
}

export const mainLogger = {
  debug: (...args: unknown[]): void => write('log', args),
  info: (...args: unknown[]): void => write('log', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
};

export { isDebugLoggingEnabled };
