import { windowManager } from '../windowManager.js';
import { store, STORE_KEYS } from '../utils/store.js';
import { sessionManager } from './sessionManager.js';

class MicrophoneManager {
  isMuted(): boolean {
    return Boolean(store.get(STORE_KEYS.MIC_MUTED));
  }

  setMuted(muted: boolean): boolean {
    store.set(STORE_KEYS.MIC_MUTED, muted);

    if (muted && sessionManager.getState() === 'listening') {
      sessionManager.setIdle();
    }

    windowManager.broadcastToAll('sally:mic-muted-changed', { muted });
    return muted;
  }
}

export const microphoneManager = new MicrophoneManager();
