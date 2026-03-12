// IPC handlers for Sally
import { ipcMain, shell } from 'electron';
import { apiKeyManager } from './managers/apiKeyManager.js';
import { microphoneManager } from './managers/microphoneManager.js';
import { sessionManager } from './managers/sessionManager.js';
import { windowManager } from './windowManager.js';
import { store, STORE_KEYS } from './utils/store.js';

export function registerIpcHandlers(): void {
  // ── Config ──

  ipcMain.handle('sally:get-config', () => {
    return {
      provider: apiKeyManager.getProvider(),
      hasProviderKey: apiKeyManager.hasApiKey(),
      hasElevenLabsKey: apiKeyManager.hasElevenLabsKey(),
      hasGeminiKey: apiKeyManager.hasGeminiApiKey(),
      geminiBackendUrl: apiKeyManager.getGeminiBackendUrl(),
      autoResearchScreenQuestions: apiKeyManager.getAutoResearchScreenQuestions(),
      audioDevice: store.get(STORE_KEYS.AUDIO_DEVICE) || 'default',
    };
  });

  ipcMain.handle('sally:get-provider', () => {
    return apiKeyManager.getProvider();
  });

  ipcMain.handle('sally:set-provider', (_e, provider: Parameters<typeof apiKeyManager.setProvider>[0]) => {
    apiKeyManager.setProvider(provider);
  });

  ipcMain.handle('sally:set-api-key', async (_e, data: { provider: Parameters<typeof apiKeyManager.setApiKey>[0]; key: string }) => {
    apiKeyManager.setApiKey(data.provider, data.key);
  });

  ipcMain.handle('sally:test-api-key', async (_e, data: { provider: Parameters<typeof apiKeyManager.testApiKey>[0]; key: string }) => {
    return apiKeyManager.testApiKey(data.provider, data.key);
  });

  ipcMain.handle('sally:clear-api-key', async () => {
    apiKeyManager.clearApiKey();
  });

  ipcMain.handle('sally:set-elevenlabs-key', (_e, key: string) => {
    apiKeyManager.setElevenLabsKey(key);
  });

  ipcMain.handle('sally:get-elevenlabs-key-status', () => {
    return apiKeyManager.hasElevenLabsKey();
  });

  ipcMain.handle('sally:set-gemini-key', (_e, key: string) => {
    apiKeyManager.setGeminiApiKey(key);
  });

  ipcMain.handle('sally:get-gemini-key-status', () => {
    return apiKeyManager.hasGeminiApiKey();
  });

  ipcMain.handle('sally:set-gemini-backend-url', (_e, url: string) => {
    apiKeyManager.setGeminiBackendUrl(url);
  });

  ipcMain.handle('sally:get-gemini-backend-url', () => {
    return apiKeyManager.getGeminiBackendUrl();
  });

  ipcMain.handle('sally:set-auto-research-screen-questions', (_e, enabled: boolean) => {
    apiKeyManager.setAutoResearchScreenQuestions(enabled);
  });

  ipcMain.handle('sally:get-auto-research-screen-questions', () => {
    return apiKeyManager.getAutoResearchScreenQuestions();
  });

  // ── Audio ──

  ipcMain.handle('sally:set-audio-device', (_e, deviceId: string) => {
    store.set(STORE_KEYS.AUDIO_DEVICE, deviceId);
  });

  ipcMain.handle('sally:get-audio-device', () => {
    return store.get(STORE_KEYS.AUDIO_DEVICE) || 'default';
  });

  // ── Voice Flow ──

  ipcMain.handle('sally:transcribe', async (_e, data: { audioBase64: string; mimeType: string; durationMs?: number }) => {
    return sessionManager.handleTranscription(data.audioBase64, data.mimeType, data.durationMs);
  });

  ipcMain.handle('sally:preview-transcription', async (_e, data: { audioBase64: string; mimeType: string; durationMs?: number }) => {
    return sessionManager.previewTranscription(data.audioBase64, data.mimeType, data.durationMs);
  });

  ipcMain.handle('sally:handle-silence', async (_e, data: { durationMs?: number; peakLevel?: number; averageLevel?: number }) => {
    await sessionManager.handleSilence(data);
  });

  ipcMain.handle('sally:send-instruction', async (_e, instruction: string) => {
    await sessionManager.executeTask(instruction);
  });

  ipcMain.handle('sally:cancel', async () => {
    await sessionManager.cancel();
  });

  ipcMain.handle('sally:get-mic-muted', () => {
    return microphoneManager.isMuted();
  });

  ipcMain.handle('sally:set-mic-muted', (_e, muted: boolean) => {
    return microphoneManager.setMuted(muted);
  });

  // ── External ──

  ipcMain.handle('sally:open-external', (_e, url: string) => {
    shell.openExternal(url);
  });

  // ── Window ──

  ipcMain.handle('window:show-config', () => {
    windowManager.showConfigWindow();
  });

  ipcMain.handle('window:set-pill-layout', (_event, data: { layout: 'idle' | 'compact' | 'composer' | 'transcript' }) => {
    windowManager.resizeSallyBar(data.layout);
  });

  ipcMain.handle('window:hide-pill', () => {
    windowManager.hideSallyBar();
  });

  ipcMain.handle('window:show-pill', () => {
    windowManager.showSallyBar();
  });

  console.log('IPC handlers registered');
}
