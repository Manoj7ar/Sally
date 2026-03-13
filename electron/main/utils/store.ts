// Persistent storage using electron-store
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { STORE_KEYS } from './constants.js';
import { mainLogger } from './logger.js';
import { repairStoreConfigFile } from './storeRepair.js';

interface StoreSchema {
  [STORE_KEYS.WINDOW_STATE]: {
    settings?: { x: number; y: number; width: number; height: number };
  };
  [STORE_KEYS.AUDIO_DEVICE]: string;
  [STORE_KEYS.ELEVENLABS_API_KEY]: string;
  [STORE_KEYS.PROVIDER]: string;
  [STORE_KEYS.SOUND_EFFECTS_ENABLED]: boolean;
  [STORE_KEYS.MIC_MUTED]: boolean;
  [STORE_KEYS.GEMINI_API_KEY]: string;
  [STORE_KEYS.GEMINI_BACKEND_URL]: string;
  [STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS]: boolean;
  [STORE_KEYS.CLOUD_LOGGING_ENABLED]: boolean;
}

const defaultValues: StoreSchema = {
  [STORE_KEYS.WINDOW_STATE]: {},
  [STORE_KEYS.AUDIO_DEVICE]: 'default',
  [STORE_KEYS.ELEVENLABS_API_KEY]: '',
  [STORE_KEYS.PROVIDER]: 'gemini',
  [STORE_KEYS.SOUND_EFFECTS_ENABLED]: true,
  [STORE_KEYS.MIC_MUTED]: false,
  [STORE_KEYS.GEMINI_API_KEY]: '',
  [STORE_KEYS.GEMINI_BACKEND_URL]: '',
  [STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS]: false,
  [STORE_KEYS.CLOUD_LOGGING_ENABLED]: true,
};

function getStoreFilePath(): string | null {
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch (error) {
    mainLogger.warn('[Store] Could not resolve config path before initialization:', error);
    return null;
  }
}

function repairStoreConfig(): void {
  repairStoreConfigFile({
    configPath: getStoreFilePath(),
    fs,
    path,
    logger: mainLogger,
  });
}

repairStoreConfig();

let store: Store<StoreSchema>;

try {
  store = new Store<StoreSchema>({ defaults: defaultValues });
  store.get(STORE_KEYS.AUDIO_DEVICE);
  mainLogger.info('Store initialized successfully');
} catch (error) {
  mainLogger.error('Failed to initialize store after repair attempt, resetting:', error);
  store = new Store<StoreSchema>({ defaults: defaultValues, clearInvalidConfig: true });
  store.clear();
}

export { store, STORE_KEYS };
export type { StoreSchema };
