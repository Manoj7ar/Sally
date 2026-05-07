// macOS push-to-talk hotkey manager for Sally
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
import { PUSH_TO_TALK_KEY_LABEL } from '../../shared/pushToTalkLabel.js';
import { microphoneManager } from './managers/microphoneManager.js';
import { windowManager } from './windowManager.js';
import { sessionManager } from './managers/sessionManager.js';
import { mainLogger } from './utils/logger.js';

const PUSH_TO_TALK_KEY = UiohookKey.AltRight;
const MIN_HOLD_DURATION = 300;
const MAX_HOLD_DURATION_MS = 30000;
const RESTART_GUARD_MS = 160;

const pushToTalkLabel = PUSH_TO_TALK_KEY_LABEL;

class HotkeyManager {
  private isHotkeyPressed = false;
  private isStarted = false;
  private keyDownTime = 0;
  private lastReleaseTime = 0;
  private safetyTimeout: NodeJS.Timeout | null = null;

  private readonly handleHookKeydown = (e: UiohookKeyboardEvent): void => {
    if (!this.isPushToTalkKey(e)) return;

    const now = Date.now();
    if (now - this.lastReleaseTime <= RESTART_GUARD_MS) {
      mainLogger.warn(`[Hotkey] Ignoring ${pushToTalkLabel} bounce immediately after release`);
      return;
    }

    if (this.isHotkeyPressed) {
      mainLogger.warn(`[Hotkey] Ignoring duplicate ${pushToTalkLabel} keydown while already pressed`);
      return;
    }

    if (microphoneManager.isMuted()) {
      mainLogger.info(`[Hotkey] ${pushToTalkLabel} pressed while mic is muted`);
      windowManager.showSallyBar();
      return;
    }

    this.isHotkeyPressed = true;
    this.keyDownTime = now;
    this.clearSafetyTimeout();
    this.safetyTimeout = setTimeout(() => {
      if (this.isHotkeyPressed) this.forceKeyUp();
    }, MAX_HOLD_DURATION_MS);

    this.onKeyDown();
  };

  private readonly handleHookKeyup = (e: UiohookKeyboardEvent): void => {
    if (this.isPushToTalkKey(e) && this.isHotkeyPressed) {
      this.processKeyRelease();
    }
  };

  isRegistered(): boolean {
    return this.isStarted;
  }

  register(): void {
    if (this.isStarted) {
      return;
    }

    mainLogger.info(`Registering push-to-talk hotkey (${pushToTalkLabel})`);

    uIOhook.on('keydown', this.handleHookKeydown);
    uIOhook.on('keyup', this.handleHookKeyup);

    try {
      uIOhook.start();
      this.isStarted = true;
      mainLogger.info(`Push-to-talk hotkey registered (${pushToTalkLabel})`);
    } catch (error) {
      uIOhook.removeListener('keydown', this.handleHookKeydown);
      uIOhook.removeListener('keyup', this.handleHookKeyup);
      mainLogger.error('Failed to start uIOhook:', error);
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

    if (holdDuration < MIN_HOLD_DURATION) {
      this.onCancel();
    } else {
      this.onKeyUp();
    }
  }

  private onKeyDown(): void {
    mainLogger.info(`[Hotkey] ${pushToTalkLabel} pressed - start recording`);
    sessionManager.beginListeningFromHotkey();
    this.sendHotkeyMessage('hotkey:start-recording', { ensureVisible: true, syncState: true });
  }

  private onKeyUp(): void {
    mainLogger.info(`[Hotkey] ${pushToTalkLabel} released - stop recording`);
    sessionManager.setState('processing');
    this.sendHotkeyMessage('hotkey:stop-recording');
  }

  private onCancel(): void {
    mainLogger.info('[Hotkey] Short press - cancelling');
    sessionManager.setIdle();
    this.sendHotkeyMessage('hotkey:cancel-recording');
  }

  private forceKeyUp(): void {
    this.isHotkeyPressed = false;
    this.keyDownTime = 0;
    this.lastReleaseTime = Date.now();
    this.clearSafetyTimeout();
    this.onKeyUp();
  }

  private isPushToTalkKey(e: UiohookKeyboardEvent): boolean {
    return e.keycode === PUSH_TO_TALK_KEY;
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
    uIOhook.removeListener('keydown', this.handleHookKeydown);
    uIOhook.removeListener('keyup', this.handleHookKeyup);
    if (this.isStarted) {
      try {
        uIOhook.stop();
      } catch {
        /* ignore */
      }
      this.isStarted = false;
    }
  }
}

export const hotkeyManager = new HotkeyManager();
