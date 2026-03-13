import { describe, expect, it, vi } from 'vitest';
import { repairStoreConfigFile, sanitizeStoreContents } from '../../../../electron/main/utils/storeRepair.ts';

describe('storeRepair', () => {
  it('sanitizes BOM-prefixed config files and removes legacy keys', () => {
    const result = sanitizeStoreContents('\uFEFF{\n  "provider": "gemini",\n  "openaiApiKeyEncrypted": "old"\n}');

    expect(result).toEqual({
      changed: true,
      content: '{\n  "provider": "gemini"\n}\n',
    });
  });

  it('normalizes empty files to an empty config object', () => {
    expect(sanitizeStoreContents('   \n\t')).toEqual({
      changed: true,
      content: '{}\n',
    });
  });

  it('backs up invalid JSON and rewrites the config file', () => {
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '{invalid json'),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      copyFileSync: vi.fn(),
    };
    const path = {
      dirname: vi.fn(() => 'C:/Users/manoj/AppData/Roaming/Sally'),
    };
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    repairStoreConfigFile({
      configPath: 'C:/Users/manoj/AppData/Roaming/Sally/config.json',
      fs,
      path,
      logger,
      now: () => 123,
    });

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      'C:/Users/manoj/AppData/Roaming/Sally/config.json',
      'C:/Users/manoj/AppData/Roaming/Sally/config.json.invalid-123.json',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'C:/Users/manoj/AppData/Roaming/Sally/config.json',
      '{}\n',
      'utf8',
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
