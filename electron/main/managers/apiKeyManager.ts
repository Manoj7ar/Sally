// API Key manager - BYOK storage for provider, Gemini, and ElevenLabs keys
import { store, STORE_KEYS } from '../utils/store.js';
import type { SallyProvider } from '../../../shared/types.js';

export interface ApiKeyStoreAdapter {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

type FetchLike = typeof fetch;
type AbortTimeoutFactory = (milliseconds: number) => AbortSignal;

export class ApiKeyManager {
  constructor(
    private readonly storage: ApiKeyStoreAdapter = store,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly abortTimeout: AbortTimeoutFactory = AbortSignal.timeout,
  ) {}

  // ============ ELEVENLABS API KEY ============

  setElevenLabsKey(key: string): void {
    this.storage.set(STORE_KEYS.ELEVENLABS_API_KEY, key);
  }

  getElevenLabsKey(): string | null {
    const value = this.storage.get(STORE_KEYS.ELEVENLABS_API_KEY);
    return typeof value === 'string' && value ? value : null;
  }

  hasElevenLabsKey(): boolean {
    return Boolean(this.getElevenLabsKey());
  }

  // ============ GEMINI API KEY ============

  setGeminiApiKey(key: string): void {
    this.storage.set(STORE_KEYS.GEMINI_API_KEY, key);
  }

  getGeminiApiKey(): string | null {
    const value = this.storage.get(STORE_KEYS.GEMINI_API_KEY);
    return typeof value === 'string' && value ? value : null;
  }

  hasGeminiApiKey(): boolean {
    return Boolean(this.getGeminiApiKey());
  }

  clearGeminiApiKey(): void {
    this.storage.set(STORE_KEYS.GEMINI_API_KEY, '');
  }

  // ============ GEMINI BACKEND URL ============

  setGeminiBackendUrl(url: string): void {
    this.storage.set(STORE_KEYS.GEMINI_BACKEND_URL, url);
  }

  getGeminiBackendUrl(): string {
    const value = this.storage.get(STORE_KEYS.GEMINI_BACKEND_URL);
    return typeof value === 'string' ? value : '';
  }

  // ============ SCREEN QUESTION AUTO RESEARCH ============

  setAutoResearchScreenQuestions(enabled: boolean): void {
    this.storage.set(STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS, enabled);
  }

  getAutoResearchScreenQuestions(): boolean {
    const value = this.storage.get(STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS);
    return typeof value === 'boolean' ? value : false;
  }

  // ============ CLOUD LOGGING ============ 

  setCloudLoggingEnabled(enabled: boolean): void {
    this.storage.set(STORE_KEYS.CLOUD_LOGGING_ENABLED, enabled);
  }

  getCloudLoggingEnabled(): boolean {
    const value = this.storage.get(STORE_KEYS.CLOUD_LOGGING_ENABLED);
    return typeof value === 'boolean' ? value : true;
  }

  // ============ GENERIC KEY METHODS (delegate by current provider) ============

  setApiKey(provider: SallyProvider, key: string): void {
    if (provider !== 'gemini') {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    this.setGeminiApiKey(key);
  }

  getApiKey(): string | null {
    return this.getGeminiApiKey();
  }

  hasApiKey(): boolean {
    return this.hasGeminiApiKey();
  }

  clearApiKey(): void {
    this.clearGeminiApiKey();
  }

  // ============ PROVIDER ============

  getProvider(): SallyProvider {
    return 'gemini';
  }

  setProvider(provider: SallyProvider): void {
    if (provider !== 'gemini') {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    this.storage.set(STORE_KEYS.PROVIDER, 'gemini');
  }

  // ============ KEY VALIDATION ============

  async testApiKey(provider: SallyProvider, key: string): Promise<boolean> {
    try {
      if (provider === 'gemini') {
        const response = await this.fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { method: 'GET', signal: this.abortTimeout(5000) },
        );
        return response.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  hasGeminiBackendUrl(): boolean {
    return this.getGeminiBackendUrl().trim().length > 0;
  }
}

export const apiKeyManager = new ApiKeyManager();
