// Sally - Main electron entry point (macOS only)
import { loadEnvFile } from 'node:process';

// Load .env before any other imports
try { loadEnvFile(); } catch { /* no .env file */ }

import { app, dialog } from 'electron';
import { windowManager, setQuitting } from './windowManager.js';
import { registerIpcHandlers } from './ipcHandlers.js';
import { sessionManager } from './managers/sessionManager.js';
import { browserService } from './services/browserService.js';
import { cloudLogger } from './services/cloudLogger.js';
import { ttsService } from './services/ttsService.js';
import { hotkeyManager } from './hotkeyManager.js';
import { mainLogger } from './utils/logger.js';
import { installMacIntegration, uninstallMacIntegration } from './macIntegration.js';
import { macPermissionsManager } from './managers/macPermissionsManager.js';

let quitAfterFlush = false;

if (process.platform !== 'darwin') {
  // Sally relies on macOS-only APIs (vibrancy, NSStatusItem windowing, AppKit
  // permission prompts, screen-saver window level). Bail loudly instead of
  // booting into a broken state on Windows or Linux.
  dialog.showErrorBox(
    'Sally is macOS only',
    'Sally requires macOS 11 or later. Please run this app on an Apple Silicon or Intel Mac.',
  );
  app.quit();
  process.exit(1);
}

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

  installMacIntegration();
  registerIpcHandlers();
  sessionManager.initialize();

  // Show config window and sally bar
  windowManager.showConfigWindow();
  windowManager.showSallyBar();

  // Restore the user's "Open at login" preference so the underlying macOS
  // login item stays in sync with what's stored.
  const { apiKeyManager } = await import('./managers/apiKeyManager.js');
  app.setLoginItemSettings({ openAtLogin: apiKeyManager.getOpenAtLogin() });

  // Wire the permission manager so it can register the push-to-talk hotkey
  // the moment Accessibility access becomes available.
  macPermissionsManager.setHotkeyRegistrar(() => {
    if (hotkeyManager.isRegistered()) return true;
    hotkeyManager.register();
    return hotkeyManager.isRegistered();
  });

  macPermissionsManager.onStatusChange((status) => {
    windowManager.broadcastToAll('permissions:status-changed', status);
  });

  macPermissionsManager.start();
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
  macPermissionsManager.stop();
  uninstallMacIntegration();
  ttsService.stop();
  sessionManager.prepareQuit();
  hotkeyManager.unregisterAll();
  await browserService.close();
  windowManager.destroyAll();
});
