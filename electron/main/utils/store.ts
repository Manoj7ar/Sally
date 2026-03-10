// Persistent storage using electron-store
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { STORE_KEYS } from './constants.js';

interface StoreSchema {
  [STORE_KEYS.WINDOW_STATE]: {
    settings?: { x: number; y: number; width: number; height: number };
  };
  [STORE_KEYS.AUDIO_DEVICE]: string;
  [STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED]: string;
  [STORE_KEYS.OPENAI_API_KEY_ENCRYPTED]: string;
  [STORE_KEYS.ELEVENLABS_API_KEY]: string;
  [STORE_KEYS.WHISPER_API_KEY]: string;
  [STORE_KEYS.PROVIDER]: string;
  [STORE_KEYS.SOUND_EFFECTS_ENABLED]: boolean;
  [STORE_KEYS.MIC_MUTED]: boolean;
  [STORE_KEYS.GEMINI_API_KEY]: string;
  [STORE_KEYS.GEMINI_BACKEND_URL]: string;
  [STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS]: boolean;
}

const defaultValues: StoreSchema = {
  [STORE_KEYS.WINDOW_STATE]: {},
  [STORE_KEYS.AUDIO_DEVICE]: 'default',
  [STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED]: '',
  [STORE_KEYS.OPENAI_API_KEY_ENCRYPTED]: '',
  [STORE_KEYS.ELEVENLABS_API_KEY]: '',
  [STORE_KEYS.WHISPER_API_KEY]: '',
  [STORE_KEYS.PROVIDER]: 'gemini',
  [STORE_KEYS.SOUND_EFFECTS_ENABLED]: true,
  [STORE_KEYS.MIC_MUTED]: false,
  [STORE_KEYS.GEMINI_API_KEY]: '',
  [STORE_KEYS.GEMINI_BACKEND_URL]: '',
  [STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS]: false,
};

function getStoreFilePath(): string | null {
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch (error) {
    console.warn('[Store] Could not resolve config path before initialization:', error);
    return null;
  }
}

function repairStoreConfig(): void {
  const configPath = getStoreFilePath();
  if (!configPath || !fs.existsSync(configPath)) {
    return;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    console.warn('[Store] Could not read existing config file:', error);
    return;
  }

  let sanitized = raw;
  let changed = false;

  if (sanitized.charCodeAt(0) === 0xfeff) {
    sanitized = sanitized.slice(1);
    changed = true;
  }

  if (!sanitized.trim()) {
    console.warn('[Store] Empty config detected. Resetting to an empty object so defaults can load.');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}\n', 'utf8');
    return;
  }

  try {
    JSON.parse(sanitized);
    if (changed) {
      console.warn('[Store] Removed UTF-8 BOM from config before store initialization.');
      fs.writeFileSync(configPath, `${sanitized.trim()}\n`, 'utf8');
    }
    return;
  } catch (error) {
    const backupPath = `${configPath}.invalid-${Date.now()}.json`;
    console.error('[Store] Invalid JSON detected in config. Backing it up and resetting:', error);
    try {
      fs.copyFileSync(configPath, backupPath);
      console.warn('[Store] Backed up invalid config to:', backupPath);
    } catch (backupError) {
      console.warn('[Store] Failed to back up invalid config:', backupError);
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}\n', 'utf8');
  }
}

repairStoreConfig();

let store: Store<StoreSchema>;

try {
  store = new Store<StoreSchema>({ defaults: defaultValues });
  store.get(STORE_KEYS.AUDIO_DEVICE);
  console.log('Store initialized successfully');
} catch (error) {
  console.error('Failed to initialize store after repair attempt, resetting:', error);
  store = new Store<StoreSchema>({ defaults: defaultValues, clearInvalidConfig: true });
  store.clear();
}

export { store, STORE_KEYS };
export type { StoreSchema };
