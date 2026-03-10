// Window management for Config, Sally Bar, and Border Overlay windows
import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG_WINDOW, SALLY_BAR } from './utils/constants.js';
import { store, STORE_KEYS } from './utils/store.js';
import type { SallyBarLayout } from '../../shared/types.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

let _isQuitting = false;
export function setQuitting(val: boolean): void { _isQuitting = val; }
export function isQuitting(): boolean { return _isQuitting; }

class WindowManager {
  private configWindow: BrowserWindow | null = null;
  private sallyBarWindow: BrowserWindow | null = null;
  private borderOverlayWindow: BrowserWindow | null = null;

  private attachWindowDiagnostics(win: BrowserWindow, name: string): void {
    win.webContents.on('console-message', (_event, level, message) => {
      const levelLabel = level === 3 ? 'error' : level === 2 ? 'warn' : 'log';
      console.log(`[Renderer:${name}:${levelLabel}] ${message}`);
    });
  }

  private getSallyBarBounds(layout: SallyBarLayout): { x: number; y: number; width: number; height: number } {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: displayX, y: displayY, width: displayWidth } = primaryDisplay.workArea;
    const width = layout === 'composer'
      ? SALLY_BAR.composerWidth
      : layout === 'transcript'
        ? SALLY_BAR.transcriptWidth
        : layout === 'idle'
          ? SALLY_BAR.idleWidth
          : SALLY_BAR.compactWidth;
    const height = layout === 'composer'
      ? SALLY_BAR.composerHeight
      : layout === 'transcript'
        ? SALLY_BAR.transcriptHeight
        : layout === 'idle'
          ? SALLY_BAR.idleHeight
          : SALLY_BAR.compactHeight;

    return {
      x: displayX + Math.round((displayWidth - width) / 2),
      y: displayY + SALLY_BAR.topOffset,
      width,
      height,
    };
  }

  private getPreloadPath(): string {
    return path.join(currentDir, '../preload/index.js');
  }

  private getRendererUrl(windowType: 'config' | 'sallyBar' | 'borderOverlay'): string {
    if (process.env.VITE_DEV_SERVER_URL) {
      const separator = process.env.VITE_DEV_SERVER_URL.includes('?') ? '&' : '?';
      return `${process.env.VITE_DEV_SERVER_URL}${separator}window=${windowType}`;
    }
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    return `file://${indexPath}?window=${windowType}`;
  }

  showConfigWindow(): BrowserWindow {
    if (this.configWindow && !this.configWindow.isDestroyed()) {
      if (process.platform === 'darwin' && !this.configWindow.isVisible()) {
        this.configWindow.destroy();
        this.configWindow = null;
      } else {
        this.configWindow.show();
        this.configWindow.focus();
        return this.configWindow;
      }
    }

    const savedState = store.get(STORE_KEYS.WINDOW_STATE)?.settings;

    this.configWindow = new BrowserWindow({
      width: savedState?.width || CONFIG_WINDOW.width,
      height: savedState?.height || CONFIG_WINDOW.height,
      x: savedState?.x,
      y: savedState?.y,
      minWidth: CONFIG_WINDOW.minWidth,
      minHeight: CONFIG_WINDOW.minHeight,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.configWindow.loadURL(this.getRendererUrl('config'));
    this.attachWindowDiagnostics(this.configWindow, 'config');

    this.configWindow.once('ready-to-show', () => {
      this.configWindow?.show();
    });

    this.configWindow.on('close', (e) => {
      if (!_isQuitting) {
        e.preventDefault();
        this.configWindow?.minimize();
      }
    });

    this.configWindow.on('resized', () => this.saveConfigWindowState());
    this.configWindow.on('moved', () => this.saveConfigWindowState());

    return this.configWindow;
  }

  private saveConfigWindowState(): void {
    if (!this.configWindow || this.configWindow.isDestroyed()) return;
    const bounds = this.configWindow.getBounds();
    store.set(STORE_KEYS.WINDOW_STATE, {
      ...store.get(STORE_KEYS.WINDOW_STATE),
      settings: bounds,
    });
  }

  showSallyBar(): BrowserWindow {
    if (this.sallyBarWindow && !this.sallyBarWindow.isDestroyed()) {
      if (this.sallyBarWindow.isVisible()) {
        this.sallyBarWindow.show();
      } else {
        this.sallyBarWindow.showInactive();
      }
      this.sallyBarWindow.moveTop();
      return this.sallyBarWindow;
    }

    const initialBounds = this.getSallyBarBounds('idle');

    this.sallyBarWindow = new BrowserWindow({
      width: initialBounds.width,
      height: initialBounds.height,
      x: initialBounds.x,
      y: initialBounds.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      roundedCorners: false,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.sallyBarWindow.loadURL(this.getRendererUrl('sallyBar'));
    this.attachWindowDiagnostics(this.sallyBarWindow, 'sallyBar');

    this.sallyBarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (process.platform === 'darwin') {
      this.sallyBarWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.sallyBarWindow.once('ready-to-show', () => {
      if (this.sallyBarWindow && !this.sallyBarWindow.isDestroyed()) {
        this.sallyBarWindow.showInactive();
        this.sallyBarWindow.moveTop();
      }
    });

    return this.sallyBarWindow;
  }

  resizeSallyBar(layout: SallyBarLayout): void {
    if (!this.sallyBarWindow || this.sallyBarWindow.isDestroyed()) return;
    this.sallyBarWindow.setBounds(this.getSallyBarBounds(layout));
  }

  hideSallyBar(): void {
    if (this.sallyBarWindow && !this.sallyBarWindow.isDestroyed()) {
      this.sallyBarWindow.hide();
    }
  }

  // ── Gold border overlay ──

  showBorderOverlay(): void {
    if (this.borderOverlayWindow && !this.borderOverlayWindow.isDestroyed()) {
      this.borderOverlayWindow.show();
      return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    this.borderOverlayWindow = new BrowserWindow({
      x: 0,
      y: 0,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: false,
      roundedCorners: false,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.borderOverlayWindow.setIgnoreMouseEvents(true);
    this.borderOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (process.platform === 'darwin') {
      this.borderOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.borderOverlayWindow.loadURL(this.getRendererUrl('borderOverlay'));
    this.attachWindowDiagnostics(this.borderOverlayWindow, 'borderOverlay');

    this.borderOverlayWindow.once('ready-to-show', () => {
      if (this.borderOverlayWindow && !this.borderOverlayWindow.isDestroyed()) {
        this.borderOverlayWindow.showInactive();
      }
    });
  }

  hideBorderOverlay(): void {
    if (this.borderOverlayWindow && !this.borderOverlayWindow.isDestroyed()) {
      this.borderOverlayWindow.hide();
    }
  }

  getSallyBarWindow(): BrowserWindow | null {
    return this.sallyBarWindow;
  }

  getConfigWindow(): BrowserWindow | null {
    return this.configWindow;
  }

  broadcastToAll(channel: string, data: unknown): void {
    const windows = [this.configWindow, this.sallyBarWindow, this.borderOverlayWindow];
    windows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }

  destroyAll(): void {
    this.configWindow?.destroy();
    this.sallyBarWindow?.destroy();
    this.borderOverlayWindow?.destroy();
    this.configWindow = null;
    this.sallyBarWindow = null;
    this.borderOverlayWindow = null;
  }
}

export const windowManager = new WindowManager();
