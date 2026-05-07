// macOS push-to-talk hotkey manager for Sally.
//
// The user-facing trigger is a single uIOhook keycode or a small combo of
// keycodes that must be held simultaneously. The bound combo is persisted in
// `electron-store` and can be re-recorded from the Settings window via the
// "capture mode" methods exposed below. When capture is active, normal PTT
// triggering is suspended so the user can replay the same keys they want to
// bind without accidentally launching a session.
import { uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi';
import { microphoneManager } from './managers/microphoneManager.js';
import { windowManager } from './windowManager.js';
import { sessionManager } from './managers/sessionManager.js';
import { store, STORE_KEYS } from './utils/store.js';
import {
  DEFAULT_PUSH_TO_TALK_KEYCODES,
  labelForKeycodes,
  sanitizeKeycodeList,
} from './utils/uiohookLabels.js';
import { PUSH_TO_TALK } from './utils/constants.js';
import { mainLogger } from './utils/logger.js';

const MIN_HOLD_DURATION_MS = 300;
const MAX_HOLD_DURATION_MS = 30_000;
const RESTART_GUARD_MS = 160;

export interface HotkeyBinding {
  keycodes: number[];
  label: string;
}

export interface HotkeyCaptureProgress {
  keycodes: number[];
  label: string;
  full: boolean;
}

export interface HotkeyCaptureEnded {
  saved: boolean;
  reason?: 'user-cancelled' | 'timeout' | 'no-keys' | 'saved';
}

class HotkeyManager {
  private isStarted = false;

  private triggerKeycodes: Set<number> = new Set(DEFAULT_PUSH_TO_TALK_KEYCODES);

  /** Subset of `triggerKeycodes` currently held down. */
  private heldTriggerKeys: Set<number> = new Set();

  /** True between full-press of all trigger keys and first release. */
  private isHotkeyActive = false;
  private keyDownTime = 0;
  private lastReleaseTime = 0;
  private safetyTimeout: NodeJS.Timeout | null = null;

  // Capture mode
  private isCapturing = false;
  private captureHeldKeys: Set<number> = new Set();
  private capturePressOrder: number[] = [];
  private captureTimeout: NodeJS.Timeout | null = null;

  isRegistered(): boolean {
    return this.isStarted;
  }

  register(): void {
    if (this.isStarted) return;

    this.loadTriggerKeycodes();
    mainLogger.info(`Registering push-to-talk hotkey (${labelForKeycodes(Array.from(this.triggerKeycodes))})`);

    uIOhook.on('keydown', this.handleHookKeydown);
    uIOhook.on('keyup', this.handleHookKeyup);

    try {
      uIOhook.start();
      this.isStarted = true;
      mainLogger.info('uIOhook started');
    } catch (error) {
      uIOhook.removeListener('keydown', this.handleHookKeydown);
      uIOhook.removeListener('keyup', this.handleHookKeyup);
      mainLogger.error('Failed to start uIOhook:', error);
    }
  }

  unregisterAll(): void {
    this.clearSafetyTimeout();
    this.clearCaptureTimeout();
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

  // ── Binding ────────────────────────────────────────────────────────────

  getBinding(): HotkeyBinding {
    const keycodes = Array.from(this.triggerKeycodes);
    return { keycodes, label: labelForKeycodes(keycodes) };
  }

  setBinding(rawKeycodes: number[]): HotkeyBinding {
    const sanitized = sanitizeKeycodeList(rawKeycodes);
    const next = sanitized.length > 0
      ? sanitized.slice(0, PUSH_TO_TALK.maxComboSize)
      : Array.from(DEFAULT_PUSH_TO_TALK_KEYCODES);
    this.triggerKeycodes = new Set(next);
    this.heldTriggerKeys.clear();
    this.isHotkeyActive = false;
    this.clearSafetyTimeout();
    store.set(STORE_KEYS.PUSH_TO_TALK_KEYCODES, next);
    const label = labelForKeycodes(next);
    mainLogger.info(`[Hotkey] Push-to-talk shortcut set to ${label}`);
    return { keycodes: next, label };
  }

  resetBindingToDefault(): HotkeyBinding {
    return this.setBinding(Array.from(DEFAULT_PUSH_TO_TALK_KEYCODES));
  }

  private loadTriggerKeycodes(): void {
    const stored = sanitizeKeycodeList(store.get(STORE_KEYS.PUSH_TO_TALK_KEYCODES));
    if (stored.length > 0) {
      this.triggerKeycodes = new Set(stored.slice(0, PUSH_TO_TALK.maxComboSize));
      return;
    }
    // First boot or invalid stored value — write the default back so the
    // settings UI has something to show even before the user touches it.
    const defaults = Array.from(DEFAULT_PUSH_TO_TALK_KEYCODES);
    this.triggerKeycodes = new Set(defaults);
    try {
      store.set(STORE_KEYS.PUSH_TO_TALK_KEYCODES, defaults);
    } catch (error) {
      mainLogger.warn('[Hotkey] Could not persist default keycodes:', error);
    }
  }

  // ── Push-to-talk event flow ────────────────────────────────────────────

  private readonly handleHookKeydown = (e: UiohookKeyboardEvent): void => {
    if (this.isCapturing) {
      this.handleCaptureKeydown(e);
      return;
    }
    if (!this.triggerKeycodes.has(e.keycode)) return;

    const now = Date.now();
    if (now - this.lastReleaseTime <= RESTART_GUARD_MS) {
      mainLogger.warn('[Hotkey] Ignoring trigger bounce immediately after release');
      return;
    }

    if (this.heldTriggerKeys.has(e.keycode)) return;
    this.heldTriggerKeys.add(e.keycode);

    if (this.isHotkeyActive) return;
    if (!this.allTriggersHeld()) return;

    if (microphoneManager.isMuted()) {
      mainLogger.info('[Hotkey] Trigger pressed while mic is muted');
      windowManager.showSallyBar();
      return;
    }

    this.isHotkeyActive = true;
    this.keyDownTime = now;
    this.clearSafetyTimeout();
    this.safetyTimeout = setTimeout(() => {
      if (this.isHotkeyActive) this.forceKeyUp();
    }, MAX_HOLD_DURATION_MS);

    this.onKeyDown();
  };

  private readonly handleHookKeyup = (e: UiohookKeyboardEvent): void => {
    if (this.isCapturing) {
      this.handleCaptureKeyup(e);
      return;
    }
    if (!this.triggerKeycodes.has(e.keycode)) return;

    this.heldTriggerKeys.delete(e.keycode);
    if (!this.isHotkeyActive) return;
    this.processKeyRelease();
  };

  private allTriggersHeld(): boolean {
    if (this.heldTriggerKeys.size < this.triggerKeycodes.size) return false;
    for (const code of this.triggerKeycodes) {
      if (!this.heldTriggerKeys.has(code)) return false;
    }
    return true;
  }

  private processKeyRelease(): void {
    if (!this.isHotkeyActive) return;

    const releasedAt = Date.now();
    const holdDuration = releasedAt - this.keyDownTime;
    this.isHotkeyActive = false;
    this.keyDownTime = 0;
    this.lastReleaseTime = releasedAt;
    this.clearSafetyTimeout();

    if (holdDuration < MIN_HOLD_DURATION_MS) {
      this.onCancel();
    } else {
      this.onKeyUp();
    }
  }

  private onKeyDown(): void {
    mainLogger.info('[Hotkey] Trigger pressed - start recording');
    sessionManager.beginListeningFromHotkey();
    this.sendHotkeyMessage('hotkey:start-recording', { ensureVisible: true, syncState: true });
  }

  private onKeyUp(): void {
    mainLogger.info('[Hotkey] Trigger released - stop recording');
    sessionManager.setState('processing');
    this.sendHotkeyMessage('hotkey:stop-recording');
  }

  private onCancel(): void {
    mainLogger.info('[Hotkey] Short press - cancelling');
    sessionManager.setIdle();
    this.sendHotkeyMessage('hotkey:cancel-recording');
  }

  private forceKeyUp(): void {
    this.isHotkeyActive = false;
    this.keyDownTime = 0;
    this.lastReleaseTime = Date.now();
    this.clearSafetyTimeout();
    this.heldTriggerKeys.clear();
    this.onKeyUp();
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

  // ── Capture mode ───────────────────────────────────────────────────────

  isCaptureActive(): boolean {
    return this.isCapturing;
  }

  startCapture(): HotkeyCaptureProgress {
    if (!this.isStarted) {
      mainLogger.warn('[Hotkey] Capture requested before uIOhook is running');
    }

    // Abort any active recording session so the user does not accidentally
    // submit the captured key combo as a transcription.
    if (this.isHotkeyActive) {
      this.isHotkeyActive = false;
      this.heldTriggerKeys.clear();
      this.clearSafetyTimeout();
      this.onCancel();
    }

    this.isCapturing = true;
    this.captureHeldKeys.clear();
    this.capturePressOrder = [];
    this.clearCaptureTimeout();
    this.captureTimeout = setTimeout(
      () => this.endCapture({ save: false, reason: 'timeout' }),
      PUSH_TO_TALK.captureTimeoutMs,
    );

    const progress: HotkeyCaptureProgress = { keycodes: [], label: 'Press your shortcut…', full: false };
    windowManager.broadcastToAll('sally:hotkey-capture-progress', progress);
    return progress;
  }

  cancelCapture(): HotkeyCaptureEnded {
    return this.endCapture({ save: false, reason: 'user-cancelled' });
  }

  private handleCaptureKeydown(e: UiohookKeyboardEvent): void {
    if (this.captureHeldKeys.has(e.keycode)) return;
    if (this.capturePressOrder.length >= PUSH_TO_TALK.maxComboSize) return;

    this.captureHeldKeys.add(e.keycode);
    this.capturePressOrder.push(e.keycode);
    this.broadcastCaptureProgress();
  }

  private handleCaptureKeyup(e: UiohookKeyboardEvent): void {
    this.captureHeldKeys.delete(e.keycode);
    if (this.captureHeldKeys.size > 0) return;
    if (this.capturePressOrder.length === 0) {
      this.endCapture({ save: false, reason: 'no-keys' });
      return;
    }
    const captured = this.capturePressOrder.slice();
    this.endCapture({ save: true, reason: 'saved', keycodes: captured });
  }

  private broadcastCaptureProgress(): void {
    const codes = this.capturePressOrder.slice();
    const progress: HotkeyCaptureProgress = {
      keycodes: codes,
      label: codes.length > 0 ? labelForKeycodes(codes) : 'Press your shortcut…',
      full: codes.length >= PUSH_TO_TALK.maxComboSize,
    };
    windowManager.broadcastToAll('sally:hotkey-capture-progress', progress);
  }

  private endCapture(opts: {
    save: boolean;
    reason: HotkeyCaptureEnded['reason'];
    keycodes?: number[];
  }): HotkeyCaptureEnded {
    if (!this.isCapturing) {
      return { saved: false, reason: opts.reason };
    }
    this.isCapturing = false;
    this.captureHeldKeys.clear();
    this.capturePressOrder = [];
    this.clearCaptureTimeout();

    if (opts.save && opts.keycodes && opts.keycodes.length > 0) {
      const binding = this.setBinding(opts.keycodes);
      windowManager.broadcastToAll('sally:hotkey-changed', binding);
    }

    const ended: HotkeyCaptureEnded = { saved: opts.save, reason: opts.reason };
    windowManager.broadcastToAll('sally:hotkey-capture-ended', ended);
    return ended;
  }

  private clearCaptureTimeout(): void {
    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }
  }
}

export const hotkeyManager = new HotkeyManager();
