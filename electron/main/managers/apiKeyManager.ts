// API Key manager - BYOK storage for provider, ElevenLabs, and Whisper keys
import { store, STORE_KEYS } from '../utils/store.js';

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

  // ============ OPENAI API KEY ============

  setOpenAIApiKey(key: string): void {
    store.set(STORE_KEYS.OPENAI_API_KEY_ENCRYPTED, key);
  }

  getOpenAIApiKey(): string | null {
    const value = store.get(STORE_KEYS.OPENAI_API_KEY_ENCRYPTED);
    return value || null;
  }

  hasOpenAIApiKey(): boolean {
    const value = store.get(STORE_KEYS.OPENAI_API_KEY_ENCRYPTED);
    return !!value && value.length > 0;
  }

  clearOpenAIApiKey(): void {
    store.set(STORE_KEYS.OPENAI_API_KEY_ENCRYPTED, '');
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

  // ============ WHISPER API KEY ============

  setWhisperKey(key: string): void {
    store.set(STORE_KEYS.WHISPER_API_KEY, key);
  }

  getWhisperKey(): string | null {
    const value = store.get(STORE_KEYS.WHISPER_API_KEY);
    return value || null;
  }

  hasWhisperKey(): boolean {
    const value = store.get(STORE_KEYS.WHISPER_API_KEY);
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

  // ============ GENERIC KEY METHODS (delegate by current provider) ============

  setApiKey(provider: string, key: string): void {
    if (provider === 'openai') {
      this.setOpenAIApiKey(key);
    } else if (provider === 'gemini') {
      this.setGeminiApiKey(key);
    } else {
      this.setAnthropicApiKey(key);
    }
  }

  getApiKey(): string | null {
    const provider = this.getProvider();
    if (provider === 'openai') return this.getOpenAIApiKey();
    if (provider === 'gemini') return this.getGeminiApiKey();
    return this.getAnthropicApiKey();
  }

  hasApiKey(): boolean {
    const provider = this.getProvider();
    if (provider === 'openai') return this.hasOpenAIApiKey();
    if (provider === 'gemini') return this.hasGeminiApiKey();
    return this.hasAnthropicApiKey();
  }

  clearApiKey(): void {
    const provider = this.getProvider();
    if (provider === 'openai') {
      this.clearOpenAIApiKey();
    } else if (provider === 'gemini') {
      this.clearGeminiApiKey();
    } else {
      this.clearAnthropicApiKey();
    }
  }

  // ============ PROVIDER ============

  getProvider(): string {
    return store.get(STORE_KEYS.PROVIDER) || 'gemini';
  }

  setProvider(provider: string): void {
    store.set(STORE_KEYS.PROVIDER, provider);
  }

  // ============ KEY VALIDATION ============

  async testApiKey(provider: string, key: string): Promise<boolean> {
    try {
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        return response.ok;
      } else if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${key}` },
        });
        return response.ok;
      } else if (provider === 'gemini') {
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
}

export const apiKeyManager = new ApiKeyManager();
