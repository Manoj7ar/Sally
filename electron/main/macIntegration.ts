// Native macOS application integration:
//   - Standard App / Edit / View / Window menu so Cmd-Q, Cmd-, Cmd-X/V, etc.
//     work the way a native AppKit user expects.
//   - About panel populated from package.json metadata.
//   - Dock context menu for quick access while Sally is running in the dock.
//   - Optional Cmd+Shift+Space global shortcut to summon the Sally Bar.
//
// macOS-only behavior; public entry points no-op on other platforms so the
// main process can import this module unconditionally.

import { app, Menu, globalShortcut, type MenuItemConstructorOptions } from 'electron';
import { windowManager } from './windowManager.js';
import { microphoneManager } from './managers/microphoneManager.js';
import { browserService } from './services/browserService.js';
import { mainLogger } from './utils/logger.js';

const SHOW_SALLY_BAR_SHORTCUT = 'CommandOrControl+Shift+Space';

let installed = false;

function buildApplicationMenu(): Menu {
  const appName = app.getName();
  const isDev = !app.isPackaged;

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: 'about', label: `About ${appName}` },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'Cmd+,',
        click: () => windowManager.showConfigWindow(),
      },
      {
        label: 'Show Sally Bar',
        accelerator: SHOW_SALLY_BAR_SHORTCUT,
        click: () => windowManager.showSallyBar(),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: `Hide ${appName}` },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: `Quit ${appName}` },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      {
        label: 'Open Sally Browser',
        click: () => { void browserService.launch(); },
      },
      { type: 'separator' },
      { role: 'front' },
    ],
  };

  return Menu.buildFromTemplate([appMenu, editMenu, viewMenu, windowMenu]);
}

function buildDockMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Show Sally Bar',
      click: () => windowManager.showSallyBar(),
    },
    {
      label: 'Open Settings',
      click: () => windowManager.showConfigWindow(),
    },
    {
      label: 'Open Sally Browser',
      click: () => { void browserService.launch(); },
    },
    { type: 'separator' },
    {
      label: microphoneManager.isMuted() ? 'Unmute Microphone' : 'Mute Microphone',
      click: () => microphoneManager.setMuted(!microphoneManager.isMuted()),
    },
  ]);
}

function refreshDockMenu(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setMenu(buildDockMenu());
}

export function installMacIntegration(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  if (installed) {
    return;
  }
  installed = true;

  app.setName('Sally');
  app.setAboutPanelOptions({
    applicationName: 'Sally',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: `Copyright © ${new Date().getFullYear()} Sally`,
    credits: 'Voice-first accessibility agent powered by Gemini and ElevenLabs.',
  });

  Menu.setApplicationMenu(buildApplicationMenu());
  refreshDockMenu();

  // Global shortcut to summon the bar even when Sally isn't focused.
  // Right Option push-to-talk still drives recording; this shortcut just
  // brings the floating bar back if the user hid it.
  try {
    const registered = globalShortcut.register(SHOW_SALLY_BAR_SHORTCUT, () => {
      windowManager.showSallyBar();
    });
    if (!registered) {
      mainLogger.warn(`[macIntegration] Could not register global shortcut ${SHOW_SALLY_BAR_SHORTCUT} (already in use).`);
    }
  } catch (error) {
    mainLogger.warn('[macIntegration] Failed to register global shortcut:', error);
  }
}

export function refreshMacDockMenu(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  refreshDockMenu();
}

export function uninstallMacIntegration(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  if (!installed) {
    return;
  }
  installed = false;
  try {
    globalShortcut.unregister(SHOW_SALLY_BAR_SHORTCUT);
  } catch {
    // best-effort cleanup
  }
}
