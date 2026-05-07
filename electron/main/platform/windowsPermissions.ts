// Windows permission snapshot + Settings deep links for the renderer permissions UI.
import { shell, systemPreferences } from 'electron';
import { hotkeyManager } from '../hotkeyManager.js';
import type { MacPermissionPane, MacPermissionState, MacPermissionsStatus } from '../../../shared/types.js';

function mapMediaStatus(value: string): MacPermissionState {
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

export function getWindowsPermissionsStatus(): MacPermissionsStatus {
  let microphone: MacPermissionState = 'unknown';
  let screen: MacPermissionState = 'unknown';
  try {
    microphone = mapMediaStatus(systemPreferences.getMediaAccessStatus('microphone'));
  } catch {
    /* ignore */
  }
  try {
    screen = mapMediaStatus(systemPreferences.getMediaAccessStatus('screen'));
  } catch {
    /* ignore */
  }
  return {
    microphone,
    screen,
    // No macOS Accessibility pane; global hotkeys rely on uIOhook + user environment.
    accessibility: 'unknown',
    pushToTalkHotkeyActive: hotkeyManager.isRegistered(),
  };
}

const WIN_SETTINGS_URLS: Record<MacPermissionPane, string> = {
  microphone: 'ms-settings:privacy-microphone',
  screen: 'ms-settings:privacy',
  accessibility: 'ms-settings:privacy',
};

export function openWindowsPrivacyPane(pane: MacPermissionPane): void {
  const url = WIN_SETTINGS_URLS[pane];
  if (url) {
    void shell.openExternal(url);
  }
}

export async function requestWindowsMicrophoneAccess(): Promise<MacPermissionState> {
  try {
    await systemPreferences.askForMediaAccess('microphone');
  } catch {
    /* ignore */
  }
  return getWindowsPermissionsStatus().microphone;
}
