import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MacPermissionsManager,
  type MacPermissionsDependencies,
} from '../../../../electron/main/managers/macPermissionsManager';

type MediaStatus = 'granted' | 'denied' | 'restricted' | 'not-determined';

function buildDeps(initial: {
  microphone: MediaStatus;
  screen: MediaStatus;
  accessibility: boolean;
}) {
  const state = { ...initial };
  const intervalCallbacks: Array<() => void> = [];

  const deps: MacPermissionsDependencies = {
    systemPreferences: {
      getMediaAccessStatus: vi.fn((kind: string) =>
        kind === 'microphone' ? state.microphone : state.screen,
      ) as unknown as MacPermissionsDependencies['systemPreferences']['getMediaAccessStatus'],
      askForMediaAccess: vi.fn(async () => {
        state.microphone = 'granted';
        return true;
      }),
      isTrustedAccessibilityClient: vi.fn(() => state.accessibility),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
    setInterval: vi.fn((cb: () => void) => {
      intervalCallbacks.push(cb);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as MacPermissionsDependencies['setInterval'],
    clearInterval: vi.fn(() => undefined) as unknown as MacPermissionsDependencies['clearInterval'],
  };

  return {
    deps,
    state,
    tick: () => intervalCallbacks.forEach((cb) => cb()),
  };
}

describe('MacPermissionsManager', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the current macOS media + accessibility status', () => {
    const { deps } = buildDeps({ microphone: 'denied', screen: 'granted', accessibility: false });
    const manager = new MacPermissionsManager(deps);
    manager.start();

    const status = manager.getStatus();
    expect(status.microphone).toBe('denied');
    expect(status.screen).toBe('granted');
    expect(status.accessibility).toBe('denied');
    expect(status.pushToTalkHotkeyActive).toBe(false);
  });

  it('opens the matching System Settings pane', async () => {
    const { deps } = buildDeps({ microphone: 'granted', screen: 'granted', accessibility: true });
    const manager = new MacPermissionsManager(deps);
    manager.openSystemSettings('microphone');
    expect(deps.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
    manager.openSystemSettings('screen');
    expect(deps.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    manager.openSystemSettings('accessibility');
    expect(deps.shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    );
  });

  it('broadcasts a status change when permissions flip', () => {
    const { deps, state, tick } = buildDeps({ microphone: 'denied', screen: 'denied', accessibility: false });
    const manager = new MacPermissionsManager(deps);
    const listener = vi.fn();
    manager.onStatusChange(listener);
    manager.start();
    expect(listener).toHaveBeenCalledTimes(1);

    // No change on second poll → no extra emission.
    tick();
    expect(listener).toHaveBeenCalledTimes(1);

    state.microphone = 'granted';
    tick();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]?.microphone).toBe('granted');
  });

  it('registers the push-to-talk hotkey the moment Accessibility is granted', () => {
    const { deps, state, tick } = buildDeps({ microphone: 'granted', screen: 'granted', accessibility: false });
    const manager = new MacPermissionsManager(deps);
    const registrar = vi.fn(() => true);
    manager.setHotkeyRegistrar(registrar);
    expect(registrar).toHaveBeenCalledTimes(1);

    manager.start();
    // Initial poll already happened during start(), but Accessibility is still
    // false so no further registration attempts.
    expect(registrar).toHaveBeenCalledTimes(1);

    state.accessibility = true;
    tick();
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(manager.getStatus().pushToTalkHotkeyActive).toBe(true);
  });

  it('asks for microphone access via askForMediaAccess', async () => {
    const { deps, state } = buildDeps({ microphone: 'not-determined', screen: 'granted', accessibility: false });
    const manager = new MacPermissionsManager(deps);
    const result = await manager.requestMicrophone();
    expect(deps.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(state.microphone).toBe('granted');
    expect(result).toBe('granted');
  });
});
