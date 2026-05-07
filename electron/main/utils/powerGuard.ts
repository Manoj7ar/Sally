// Thin wrapper around `powerSaveBlocker` that prevents the macOS display from
// dimming/sleeping while Sally is actively running an agentic loop or speaking
// a long response. Idempotent — calling `engage()` multiple times only opens
// one underlying blocker. Calling `release()` is always safe.

import { powerSaveBlocker } from 'electron';
import { mainLogger } from './logger.js';

let activeBlockerId: number | null = null;

export function engagePowerGuard(): void {
  if (activeBlockerId !== null && powerSaveBlocker.isStarted(activeBlockerId)) {
    return;
  }
  try {
    activeBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  } catch (error) {
    mainLogger.warn('[PowerGuard] Failed to start power-save blocker:', error);
    activeBlockerId = null;
  }
}

export function releasePowerGuard(): void {
  if (activeBlockerId === null) return;
  try {
    if (powerSaveBlocker.isStarted(activeBlockerId)) {
      powerSaveBlocker.stop(activeBlockerId);
    }
  } catch (error) {
    mainLogger.warn('[PowerGuard] Failed to stop power-save blocker:', error);
  } finally {
    activeBlockerId = null;
  }
}

export function __resetPowerGuardForTests(): void {
  activeBlockerId = null;
}
