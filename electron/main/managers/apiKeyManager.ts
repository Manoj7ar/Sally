// API Key manager - BYOK storage for provider, Gemini, and ElevenLabs keys
import { store, STORE_KEYS } from '../utils/store.js';
import type { SallyProvider } from '../../../shared/types.js';

class ApiKeyManager {
  // ============ ANTHROPIC API KEY ============

  setAnthropicApiKey(key: string): void {
    store.set(STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED, key);
  }

  getAnthropicApiKey(): string | null {
    const value = store.get(STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED);
    return value || null;
  }

  hasAnthropicApiKey(): boolean {
    const value = store.get(STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED);
    return !!value && value.length > 0;
  }

  clearAnthropicApiKey(): void {
    store.set(STORE_KEYS.ANTHROPIC_API_KEY_ENCRYPTED, '');
  }

  // ============ ELEVENLABS API KEY ============

  setElevenLabsKey(key: string): void {
    store.set(STORE_KEYS.ELEVENLABS_API_KEY, key);
  }

  getElevenLabsKey(): string | null {
    const value = store.get(STORE_KEYS.ELEVENLABS_API_KEY);
    return value || null;
  }

  hasElevenLabsKey(): boolean {
    const value = store.get(STORE_KEYS.ELEVENLABS_API_KEY);
    return !!value && value.length > 0;
  }

  // ============ GEMINI API KEY ============

  setGeminiApiKey(key: string): void {
    store.set(STORE_KEYS.GEMINI_API_KEY, key);
  }

  getGeminiApiKey(): string | null {
    const value = store.get(STORE_KEYS.GEMINI_API_KEY);
    return value || null;
  }

  hasGeminiApiKey(): boolean {
    const value = store.get(STORE_KEYS.GEMINI_API_KEY);
    return !!value && value.length > 0;
  }

  clearGeminiApiKey(): void {
    store.set(STORE_KEYS.GEMINI_API_KEY, '');
  }

  // ============ GEMINI BACKEND URL ============

  setGeminiBackendUrl(url: string): void {
    store.set(STORE_KEYS.GEMINI_BACKEND_URL, url);
  }

  getGeminiBackendUrl(): string {
    return store.get(STORE_KEYS.GEMINI_BACKEND_URL) || '';
  }

  // ============ SCREEN QUESTION AUTO RESEARCH ============

  setAutoResearchScreenQuestions(enabled: boolean): void {
    store.set(STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS, enabled);
  }

  getAutoResearchScreenQuestions(): boolean {
    return store.get(STORE_KEYS.AUTO_RESEARCH_SCREEN_QUESTIONS) ?? false;
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
    store.set(STORE_KEYS.PROVIDER, 'gemini');
  }

  // ============ KEY VALIDATION ============

  async testApiKey(provider: SallyProvider, key: string): Promise<boolean> {
    try {
      if (provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { method: 'GET', signal: AbortSignal.timeout(5000) },
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
