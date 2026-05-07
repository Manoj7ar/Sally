function isRendererDebugLoggingEnabled(): boolean {
  return Boolean(import.meta.env.DEV) || import.meta.env.VITE_SALLY_DEBUG === '1';
}

function write(method: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (!isRendererDebugLoggingEnabled()) {
    return;
  }

  console[method](...args);
}

export const rendererLogger = {
  debug: (...args: unknown[]): void => write('log', args),
  info: (...args: unknown[]): void => write('log', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
};

export { isRendererDebugLoggingEnabled };
