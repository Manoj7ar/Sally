// Simplified push-to-talk hotkey manager for Sally
import { spawn, type ChildProcess } from 'node:child_process';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
import { microphoneManager } from './managers/microphoneManager.js';
import { windowManager } from './windowManager.js';
import { sessionManager } from './managers/sessionManager.js';
import { ttsService } from './services/ttsService.js';

const PUSH_TO_TALK_KEY = UiohookKey.AltRight;
const MIN_HOLD_DURATION = 300;
const MAX_HOLD_DURATION_MS = 30000;
const RESTART_GUARD_MS = 160;
const WINDOWS_RIGHT_ALT_VK = 0xA5;

function createWindowsReleaseWatcherCommand(virtualKey: number): string {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SallyKeyState {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int virtualKey);
}
"@;
while (($true)) {
  $isDown = ([SallyKeyState]::GetAsyncKeyState(${virtualKey}) -band 0x8000) -ne 0;
  if (-not $isDown) { break; }
  Start-Sleep -Milliseconds 15;
}
Write-Output "released";
`;

  return Buffer.from(script, 'utf16le').toString('base64');
}

class HotkeyManager {
  private isHotkeyPressed = false;
  private isStarted = false;
  private keyDownTime = 0;
  private lastReleaseTime = 0;
  private safetyTimeout: NodeJS.Timeout | null = null;
  private releaseWatcher: ChildProcess | null = null;

  register(): void {
    console.log('Registering push-to-talk hotkey (Right Option)');

    uIOhook.on('keydown', (e) => {
      if (!this.isPushToTalkKey(e)) return;

      const now = Date.now();
      if (now - this.lastReleaseTime <= RESTART_GUARD_MS) {
        console.warn('[Hotkey] Ignoring right Option bounce immediately after release');
        return;
      }

      if (this.isHotkeyPressed) {
        console.warn('[Hotkey] Ignoring duplicate right Option keydown while already pressed');
        return;
      }

      if (microphoneManager.isMuted()) {
        console.log('[Hotkey] Right Option pressed while mic is muted');
        windowManager.showSallyBar();
        return;
      }

      this.isHotkeyPressed = true;
      this.keyDownTime = now;
      this.clearSafetyTimeout();
      this.startPhysicalReleaseWatcher();
      this.safetyTimeout = setTimeout(() => {
        if (this.isHotkeyPressed) this.forceKeyUp();
      }, MAX_HOLD_DURATION_MS);

      this.onKeyDown();
    });

    uIOhook.on('keyup', (e) => {
      if (this.isPushToTalkKey(e) && this.isHotkeyPressed) {
        this.processKeyRelease();
      }
    });

    try {
      uIOhook.start();
      this.isStarted = true;
      console.log('Push-to-talk hotkey registered (Right Option)');
    } catch (error) {
      console.error('Failed to start uIOhook:', error);
    }
  }

  private processKeyRelease(): void {
    if (!this.isHotkeyPressed) return;

    const releasedAt = Date.now();
    const holdDuration = releasedAt - this.keyDownTime;
    this.isHotkeyPressed = false;
    this.keyDownTime = 0;
    this.lastReleaseTime = releasedAt;
    this.clearSafetyTimeout();
    this.stopPhysicalReleaseWatcher();

    if (holdDuration < MIN_HOLD_DURATION) {
      // Too short, cancel
      this.onCancel();
    } else {
      this.onKeyUp();
    }
  }

  private onKeyDown(): void {
    console.log('[Hotkey] Right Option pressed - start recording');
    ttsService.stop();
    sessionManager.setListening();
    this.sendHotkeyMessage('hotkey:start-recording', { ensureVisible: true, syncState: true });
  }

  private onKeyUp(): void {
    console.log('[Hotkey] Right Option released - stop recording');
    // Immediately transition to processing state so the UI updates instantly
    sessionManager.setState('processing');
    this.sendHotkeyMessage('hotkey:stop-recording');
  }

  private onCancel(): void {
    console.log('[Hotkey] Short press - cancelling');
    sessionManager.setIdle();
    this.sendHotkeyMessage('hotkey:cancel-recording');
  }

  private forceKeyUp(): void {
    this.isHotkeyPressed = false;
    this.keyDownTime = 0;
    this.lastReleaseTime = Date.now();
    this.clearSafetyTimeout();
    this.stopPhysicalReleaseWatcher();
    this.onKeyUp();
  }

  private isPushToTalkKey(e: UiohookKeyboardEvent): boolean {
    return e.keycode === PUSH_TO_TALK_KEY;
  }

  private startPhysicalReleaseWatcher(): void {
    this.stopPhysicalReleaseWatcher();

    if (process.platform !== 'win32') {
      return;
    }

    const encodedCommand = createWindowsReleaseWatcherCommand(WINDOWS_RIGHT_ALT_VK);
    const watcher = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    this.releaseWatcher = watcher;

    watcher.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim().toLowerCase();
      if (!text.includes('released')) return;
      if (!this.isHotkeyPressed) return;

      console.warn('[Hotkey] Physical Right Alt release detected by fallback watcher');
      this.processKeyRelease();
    });

    watcher.once('exit', () => {
      if (this.releaseWatcher === watcher) {
        this.releaseWatcher = null;
      }
    });
  }

  private stopPhysicalReleaseWatcher(): void {
    const watcher = this.releaseWatcher;
    this.releaseWatcher = null;
    if (!watcher || watcher.killed) return;

    try {
      watcher.kill();
    } catch {
      // Ignore cleanup failures from the release watcher.
    }
  }

  private sendHotkeyMessage(
    channel: 'hotkey:start-recording' | 'hotkey:stop-recording' | 'hotkey:cancel-recording',
    options: { ensureVisible?: boolean; syncState?: boolean } = {},
  ): void {
    const sallyBar = options.ensureVisible
      ? windowManager.showSallyBar()
      : windowManager.getSallyBarWindow();

    if (!sallyBar || sallyBar.isDestroyed()) return;

    const send = () => {
      if (sallyBar.isDestroyed()) return;
      if (options.syncState) {
        sallyBar.webContents.send('sally:state-changed', { state: sessionManager.getState() });
      }
      sallyBar.webContents.send(channel);
    };

    if (sallyBar.webContents.isLoadingMainFrame()) {
      sallyBar.webContents.once('did-finish-load', send);
      return;
    }

    send();
  }

  private clearSafetyTimeout(): void {
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
  }

  unregisterAll(): void {
    this.clearSafetyTimeout();
    this.stopPhysicalReleaseWatcher();
    if (this.isStarted) {
      try { uIOhook.stop(); } catch { /* ignore */ }
      this.isStarted = false;
    }
  }
}

export const hotkeyManager = new HotkeyManager();
