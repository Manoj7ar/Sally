import { beforeAll, describe, expect, it, vi } from 'vitest';

function createStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get(key: string) {
      return data.get(key);
    },
    set(key: string, value: unknown) {
      data.set(key, value);
    },
  };
}

describe('ApiKeyManager', () => {
  let ApiKeyManagerClass: typeof import('../../../../electron/main/managers/apiKeyManager.ts').ApiKeyManager;

  beforeAll(async () => {
    vi.mock('electron', () => ({
      app: {
        isPackaged: true,
        getPath: () => 'C:/Users/manoj/AppData/Roaming/Sally',
      },
    }));
    vi.mock('electron-store', () => ({
      default: class MockStore {
        get() {
          return '';
        }

        set() {}

        clear() {}
      },
    }));

    ({ ApiKeyManager: ApiKeyManagerClass } = await import('../../../../electron/main/managers/apiKeyManager.ts'));
  });

  it('delegates generic provider key methods to Gemini storage', () => {
    const store = createStore();
    const manager = new ApiKeyManagerClass(store);

    manager.setApiKey('gemini', 'gem-key');

    expect(manager.getApiKey()).toBe('gem-key');
    expect(manager.hasApiKey()).toBe(true);

    manager.clearApiKey();
    expect(manager.getApiKey()).toBeNull();
    expect(manager.hasApiKey()).toBe(false);
  });

  it('stores backend URL and auto research flags', () => {
    const store = createStore();
    const manager = new ApiKeyManagerClass(store);

    manager.setGeminiBackendUrl('https://backend.example');
    manager.setAutoResearchScreenQuestions(true);

    expect(manager.getGeminiBackendUrl()).toBe('https://backend.example');
    expect(manager.hasGeminiBackendUrl()).toBe(true);
    expect(manager.getAutoResearchScreenQuestions()).toBe(true);
  });

  it('rejects unsupported providers and validates Gemini keys through injected fetch', async () => {
    const store = createStore();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    const abortTimeout = vi.fn(() => new AbortController().signal);
    const manager = new ApiKeyManagerClass(store, fetchMock, abortTimeout);

    expect(() => manager.setProvider('gemini')).not.toThrow();
    expect(() => manager.setApiKey('gemini', 'abc')).not.toThrow();
    expect(() => manager.setProvider('anthropic' as never)).toThrow('Unsupported provider');

    await expect(manager.testApiKey('gemini', 'secret')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(abortTimeout).toHaveBeenCalledWith(5000);
  });
});
