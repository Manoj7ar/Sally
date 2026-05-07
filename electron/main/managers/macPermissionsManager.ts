// macOS-only permissions tracker for Sally.
//
// Sally needs three privacy-protected capabilities:
//   • Microphone        - getUserMedia capture for voice commands
//   • Screen Recording  - desktopCapturer screenshots for Gemini Vision
//   • Accessibility     - global push-to-talk via uiohook-napi
//
// AppKit only grants these via System Settings, and `electron` cannot prompt
// directly for Screen Recording or Accessibility without first invoking the
// API that requires them. This manager:
//   1. Polls `systemPreferences` so the renderer can show an honest live
//      status banner even after the user toggles permission outside the app.
//   2. Exposes deep-links into the matching System Settings panes.
//   3. Auto-registers the global hotkey the moment Accessibility flips on,
//      so the user does not have to relaunch Sally.

import { shell, systemPreferences } from 'electron';
import type {
  MacPermissionPane,
  MacPermissionState,
  MacPermissionsStatus,
} from '../../../shared/types.js';
import { mainLogger } from '../utils/logger.js';

const POLL_INTERVAL_MS = 5_000;

const SETTINGS_PANE_URLS: Record<MacPermissionPane, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};

type MediaAccessStatus = ReturnType<typeof systemPreferences.getMediaAccessStatus>;

function mapMediaStatus(value: MediaAccessStatus): MacPermissionState {
  switch (value) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'not-determined':
      return 'not-determined';
    default:
      return 'unknown';
  }
}

export interface MacPermissionsDependencies {
  systemPreferences: Pick<
    typeof systemPreferences,
    'getMediaAccessStatus' | 'askForMediaAccess' | 'isTrustedAccessibilityClient'
  >;
  shell: Pick<typeof shell, 'openExternal'>;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const defaultDeps: MacPermissionsDependencies = {
  systemPreferences,
  shell,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

export class MacPermissionsManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cachedStatus: MacPermissionsStatus | null = null;
  private listeners = new Set<(status: MacPermissionsStatus) => void>();
  private hotkeyRegistered = false;
  private hotkeyRegistrar: (() => boolean) | null = null;

  constructor(private readonly deps: MacPermissionsDependencies = defaultDeps) {}

  /** Wires the callback that registers (or re-registers) the global hotkey
   *  once Accessibility permission becomes available. Should return true if
   *  the hotkey is now active. */
  setHotkeyRegistrar(registrar: () => boolean): void {
    this.hotkeyRegistrar = registrar;
    const becameActive = registrar();
    let accessibilityGranted = false;
    try {
      accessibilityGranted = this.deps.systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      /* ignore */
    }
    this.hotkeyRegistered = becameActive && accessibilityGranted;
  }

  start(): void {
    if (this.timer) return;
    // Push an initial reading immediately so the renderer can render banners
    // without waiting for the first poll tick.
    this.refresh();
    this.timer = this.deps.setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      this.deps.clearInterval(this.timer);
      this.timer = null;
    }
  }

  onStatusChange(listener: (status: MacPermissionsStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): MacPermissionsStatus {
    return this.cachedStatus ?? this.computeStatus();
  }

  async requestMicrophone(): Promise<MacPermissionState> {
    try {
      await this.deps.systemPreferences.askForMediaAccess('microphone');
    } catch (error) {
      mainLogger.warn('[Permissions] askForMediaAccess(microphone) failed:', error);
    }
    this.refresh();
    return this.cachedStatus?.microphone ?? 'unknown';
  }

  /** Triggers macOS' system Accessibility prompt the first time only.
   *  Subsequent calls are a no-op until the user grants and relaunches. */
  promptAccessibility(): MacPermissionState {
    try {
      this.deps.systemPreferences.isTrustedAccessibilityClient(true);
    } catch (error) {
      mainLogger.warn('[Permissions] isTrustedAccessibilityClient prompt failed:', error);
    }
    this.refresh();
    return this.cachedStatus?.accessibility ?? 'unknown';
  }

  openSystemSettings(pane: MacPermissionPane): void {
    const url = SETTINGS_PANE_URLS[pane];
    if (!url) return;
    void this.deps.shell.openExternal(url);
  }

  private computeStatus(): MacPermissionsStatus {
    let microphone: MacPermissionState = 'unknown';
    let screen: MacPermissionState = 'unknown';
    let accessibility: MacPermissionState = 'unknown';

    try {
      microphone = mapMediaStatus(this.deps.systemPreferences.getMediaAccessStatus('microphone'));
    } catch (error) {
      mainLogger.warn('[Permissions] microphone status check failed:', error);
    }
    try {
      screen = mapMediaStatus(this.deps.systemPreferences.getMediaAccessStatus('screen'));
    } catch (error) {
      mainLogger.warn('[Permissions] screen status check failed:', error);
    }
    try {
      accessibility = this.deps.systemPreferences.isTrustedAccessibilityClient(false)
        ? 'granted'
        : 'denied';
    } catch (error) {
      mainLogger.warn('[Permissions] accessibility status check failed:', error);
    }

    return {
      microphone,
      screen,
      accessibility,
      pushToTalkHotkeyActive: this.hotkeyRegistered,
    };
  }

  private refresh(): void {
    const next = this.computeStatus();

    // If accessibility just became granted, register the hotkey and update
    // the cached "active" flag before broadcasting.
    if (next.accessibility === 'granted' && !this.hotkeyRegistered && this.hotkeyRegistrar) {
      try {
        this.hotkeyRegistered = this.hotkeyRegistrar();
        next.pushToTalkHotkeyActive = this.hotkeyRegistered;
      } catch (error) {
        mainLogger.error('[Permissions] Hotkey registrar threw:', error);
      }
    }

    if (this.cachedStatus && this.statusEquals(this.cachedStatus, next)) {
      return;
    }

    this.cachedStatus = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch (error) {
        mainLogger.error('[Permissions] Listener threw:', error);
      }
    }
  }

  private statusEquals(a: MacPermissionsStatus, b: MacPermissionsStatus): boolean {
    return (
      a.microphone === b.microphone
      && a.screen === b.screen
      && a.accessibility === b.accessibility
      && a.pushToTalkHotkeyActive === b.pushToTalkHotkeyActive
    );
  }
}

export const macPermissionsManager = new MacPermissionsManager();
