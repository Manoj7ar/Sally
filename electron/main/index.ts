// Sally - Main Electron entry point (macOS + Windows)
import { loadEnvFile } from 'node:process';

// Load .env before any other imports
try { loadEnvFile(); } catch { /* no .env file */ }

import { app } from 'electron';
import { windowManager, setQuitting } from './windowManager.js';
import { registerIpcHandlers } from './ipcHandlers.js';
import { sessionManager } from './managers/sessionManager.js';
import { browserService } from './services/browserService.js';
import { cloudLogger } from './services/cloudLogger.js';
import { ttsService } from './services/ttsService.js';
import { hotkeyManager } from './hotkeyManager.js';
import { mainLogger } from './utils/logger.js';
import { assertSupportedDesktopPlatform, registerAfterAppReady, teardownBeforeQuit } from './platform/desktopHost.js';

let quitAfterFlush = false;

assertSupportedDesktopPlatform();

// Prevent multiple instances
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  windowManager.showConfigWindow();
});

app.whenReady().then(async () => {
  mainLogger.info('Sally starting...');

  registerIpcHandlers();
  sessionManager.initialize();

  windowManager.showConfigWindow();
  windowManager.showSallyBar();

  await registerAfterAppReady();
});

app.on('activate', () => {
  windowManager.showConfigWindow();
  windowManager.showSallyBar();
});

app.on('window-all-closed', () => {
  // Don't quit on window close (sally bar stays)
});

app.on('before-quit', (event) => {
  setQuitting(true);
  if (quitAfterFlush) {
    return;
  }

  quitAfterFlush = true;
  event.preventDefault();
  void cloudLogger.shutdown()
    .catch((error) => {
      mainLogger.error('[CloudLogger] Failed to flush logs during shutdown:', error);
    })
    .finally(() => {
      app.quit();
    });
});

app.on('will-quit', async () => {
  teardownBeforeQuit();
  ttsService.stop();
  sessionManager.prepareQuit();
  hotkeyManager.unregisterAll();
  await browserService.close();
  windowManager.destroyAll();
});
