export const LEGACY_STORE_KEYS = ['openaiApiKeyEncrypted', 'whisperApiKey'] as const;

export interface StoreRepairLogger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface StoreRepairFs {
  existsSync: typeof import('node:fs').existsSync;
  readFileSync: typeof import('node:fs').readFileSync;
  mkdirSync: typeof import('node:fs').mkdirSync;
  writeFileSync: typeof import('node:fs').writeFileSync;
  copyFileSync: typeof import('node:fs').copyFileSync;
}

export interface StoreRepairPath {
  dirname: (path: string) => string;
}

export function sanitizeStoreContents(raw: string): { changed: boolean; content: string } {
  let sanitized = raw;
  let changed = false;

  if (sanitized.charCodeAt(0) === 0xfeff) {
    sanitized = sanitized.slice(1);
    changed = true;
  }

  if (!sanitized.trim()) {
    return { changed: true, content: '{}\n' };
  }

  const parsed = JSON.parse(sanitized) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const config = parsed as Record<string, unknown>;
    let removedLegacyKeys = false;
    for (const key of LEGACY_STORE_KEYS) {
      if (key in config) {
        delete config[key];
        removedLegacyKeys = true;
      }
    }

    if (removedLegacyKeys) {
      sanitized = JSON.stringify(config, null, 2);
      changed = true;
    }
  }

  return {
    changed,
    content: changed ? `${sanitized.trim()}\n` : raw,
  };
}

export function repairStoreConfigFile(params: {
  configPath: string | null;
  fs: StoreRepairFs;
  path: StoreRepairPath;
  logger: StoreRepairLogger;
  now?: () => number;
}): void {
  const {
    configPath,
    fs,
    path,
    logger,
    now = () => Date.now(),
  } = params;

  if (!configPath || !fs.existsSync(configPath)) {
    return;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    logger.warn('[Store] Could not read existing config file:', error);
    return;
  }

  try {
    const { changed, content } = sanitizeStoreContents(raw);
    if (!changed) {
      return;
    }

    if (content === '{}\n') {
      logger.warn('[Store] Empty config detected. Resetting to an empty object so defaults can load.');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, content, 'utf8');
      return;
    }

    logger.warn('[Store] Removed legacy OpenAI/Whisper keys from config.');
    fs.writeFileSync(configPath, content, 'utf8');
  } catch (error) {
    const backupPath = `${configPath}.invalid-${now()}.json`;
    logger.error('[Store] Invalid JSON detected in config. Backing it up and resetting:', error);
    try {
      fs.copyFileSync(configPath, backupPath);
      logger.warn('[Store] Backed up invalid config to:', backupPath);
    } catch (backupError) {
      logger.warn('[Store] Failed to back up invalid config:', backupError);
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}\n', 'utf8');
  }
}
