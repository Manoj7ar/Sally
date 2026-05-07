// Cross-platform desktop bootstrap: macOS integration + permission orchestration vs Windows.
import { app, dialog } from 'electron';
import { hotkeyManager } from '../hotkeyManager.js';
import { windowManager } from '../windowManager.js';
import { mainLogger } from '../utils/logger.js';
import { installMacIntegration, uninstallMacIntegration } from '../macIntegration.js';
import { macPermissionsManager } from '../managers/macPermissionsManager.js';
import { getWindowsPermissionsStatus } from './windowsPermissions.js';

export const isMacOS = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';

export function assertSupportedDesktopPlatform(): void {
  if (isMacOS || isWindows) {
    return;
  }
  dialog.showErrorBox(
    'Unsupported platform',
    'Sally supports macOS and Windows. Please run the app on a supported desktop OS.',
  );
  app.quit();
  process.exit(1);
}

export async function registerAfterAppReady(): Promise<void> {
  if (isMacOS) {
    installMacIntegration();
  }

  const { apiKeyManager } = await import('../managers/apiKeyManager.js');
  app.setLoginItemSettings({ openAtLogin: apiKeyManager.getOpenAtLogin() });

  if (isMacOS) {
    macPermissionsManager.setHotkeyRegistrar(() => {
      if (hotkeyManager.isRegistered()) return true;
      hotkeyManager.register();
      return hotkeyManager.isRegistered();
    });

    macPermissionsManager.onStatusChange((status) => {
      windowManager.broadcastToAll('permissions:status-changed', status);
    });

    macPermissionsManager.start();
  } else if (isWindows) {
    try {
      if (!hotkeyManager.isRegistered()) {
        hotkeyManager.register();
      }
    } catch (error) {
      mainLogger.error('[DesktopHost] Failed to register push-to-talk on Windows:', error);
    }
    windowManager.broadcastToAll('permissions:status-changed', getWindowsPermissionsStatus());
  }
}

export function teardownBeforeQuit(): void {
  if (isMacOS) {
    macPermissionsManager.stop();
    uninstallMacIntegration();
  }
}
