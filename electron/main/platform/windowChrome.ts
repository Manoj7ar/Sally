// BrowserWindow option helpers so macOS-only flags are never passed on Windows.
import type { BrowserWindowConstructorOptions } from 'electron';

function isDarwin(): boolean {
  return process.platform === 'darwin';
}

/** Shared webPreferences for all Sally renderer windows. */
export function baseWebPreferences(preloadPath: string): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}

export function configWindowChrome(): Partial<BrowserWindowConstructorOptions> {
  if (isDarwin()) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      roundedCorners: true,
      fullscreenable: false,
    };
  }
  return {
    title: 'Sally',
    autoHideMenuBar: false,
    fullscreenable: true,
  };
}

export function browserWindowChrome(): Partial<BrowserWindowConstructorOptions> {
  if (isDarwin()) {
    return {
      title: 'Sally Browser',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
      roundedCorners: true,
    };
  }
  return {
    title: 'Sally Browser',
    autoHideMenuBar: false,
  };
}

/** Sally bar / overlay: apply always-on-top and privacy hints after construction. */
export function applyFloatingChrome(win: import('electron').BrowserWindow): void {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isDarwin()) {
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      win.setAlwaysOnTop(true);
    }
    try {
      win.setContentProtection(true);
    } catch {
      /* optional on some macOS builds */
    }
    try {
      win.setWindowButtonVisibility(false);
    } catch {
      /* optional */
    }
  } else {
    win.setAlwaysOnTop(true, 'floating');
    try {
      win.setContentProtection(true);
    } catch {
      /* Windows may not support; ignore */
    }
  }
}
