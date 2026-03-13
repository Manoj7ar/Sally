// IPC handlers for Sally
import { ipcMain, shell } from 'electron';
import { apiKeyManager } from './managers/apiKeyManager.js';
import { microphoneManager } from './managers/microphoneManager.js';
import { sessionManager } from './managers/sessionManager.js';
import { browserService } from './services/browserService.js';
import { windowManager } from './windowManager.js';
import { store, STORE_KEYS } from './utils/store.js';
import { mainLogger } from './utils/logger.js';
import type { BrowserActionRequest } from '../../shared/types.js';

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

  ipcMain.handle('sally:handle-silence', async (_e, data: { durationMs?: number; peakLevel?: number; averageLevel?: number; mode?: 'default' | 'confirmation' }) => {
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

  ipcMain.handle('browser:get-state', async () => {
    return browserService.getUiState();
  });

  ipcMain.handle('browser:new-tab', async (_e, data?: { url?: string }) => {
    await browserService.openTab(data?.url, { activate: true });
    return browserService.getUiState();
  });

  ipcMain.handle('browser:switch-tab', async (_e, data: { tabId: string }) => {
    await browserService.switchToTab(data.tabId);
    return browserService.getUiState();
  });

  ipcMain.handle('browser:close-tab', async (_e, data: { tabId: string }) => {
    await browserService.closeTab(data.tabId);
    return browserService.getUiState();
  });

  ipcMain.handle('browser:navigate', async (_e, data: { url: string }) => {
    await browserService.navigateActiveTab(data.url);
    return browserService.getUiState();
  });

  ipcMain.handle('browser:go-back', async () => {
    await browserService.goBack();
    return browserService.getUiState();
  });

  ipcMain.handle('browser:go-forward', async () => {
    await browserService.goForward();
    return browserService.getUiState();
  });

  ipcMain.handle('browser:reload', async () => {
    await browserService.reloadActiveTab();
    return browserService.getUiState();
  });

  ipcMain.handle('browser:get-snapshot', async () => {
    const snapshot = await browserService.captureBrowserSnapshot().catch(() => null);
    if (!snapshot) {
      return null;
    }

    return {
      pageUrl: snapshot.pageUrl,
      pageTitle: snapshot.pageTitle,
      headings: snapshot.pageContext.headings,
      visibleMessages: snapshot.pageContext.visibleMessages,
      interactiveCount: snapshot.pageContext.interactiveElements.length,
      activeTabId: snapshot.activeTabId,
      tabCount: snapshot.tabs.length,
    };
  });

  ipcMain.handle('browser:execute-action', async (_e, action: BrowserActionRequest) => {
    return browserService.executeAction(action);
  });

  ipcMain.handle('browser:inspect-gmail-draft', async () => {
    return browserService.inspectGmailDraft();
  });


  // ── Window ──

  ipcMain.handle('window:show-config', () => {
    windowManager.showConfigWindow();
  });

  ipcMain.handle('window:show-browser', () => {
    return browserService.launch().then(() => undefined);
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

  mainLogger.info('IPC handlers registered');
}
