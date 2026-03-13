// ElevenLabs TTS service with queued speech — audio played via renderer IPC
import { ipcMain } from 'electron';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { windowManager } from '../windowManager.js';
import { cloudLog } from './cloudLogger.js';
import { ELEVENLABS_MODEL_ID, ELEVENLABS_VOICE_ID } from '../utils/constants.js';
import { mainLogger } from '../utils/logger.js';

const PLAYBACK_TIMEOUT_MS = 30_000;

let nextId = 0;

class TtsService {
  private speechQueue: string[] = [];
  private isPlaying = false;
  private stopped = false;
  private pendingResolve: (() => void) | null = null;
  private pendingId: string | null = null;

  constructor() {
    ipcMain.on('sally:tts-playback-complete', (_event, data: { id: string }) => {
      if (data?.id === this.pendingId && this.pendingResolve) {
        this.pendingResolve();
        this.pendingResolve = null;
        this.pendingId = null;
      }
    });

    ipcMain.on('sally:tts-playback-error', (_event, data: { id: string; message: string }) => {
      if (!data?.id) return;
      mainLogger.error('[TTS] Renderer playback error for', data.id, '-', data.message);
    });
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;
    this.speechQueue.push(text);
    if (!this.isPlaying) {
      this.processQueue();
    }
  }

  async speakImmediate(text: string): Promise<void> {
    this.speechQueue = [];
    this.stopCurrentPlayback();
    if (!text.trim()) return;
    await this.playText(text);
  }

  stop(): void {
    this.stopped = true;
    this.speechQueue = [];
    this.stopCurrentPlayback();
    this.stopped = false;
  }

  isSpeaking(): boolean {
    return this.isPlaying;
  }

  private stopCurrentPlayback(): void {
    if (this.pendingResolve) {
      this.pendingResolve();
      this.pendingResolve = null;
      this.pendingId = null;
    }
    windowManager.broadcastToAll('sally:tts-stop', undefined);
  }

  private async processQueue(): Promise<void> {
    this.isPlaying = true;

    while (this.speechQueue.length > 0 && !this.stopped) {
      const text = this.speechQueue.shift()!;
      try {
        await this.playText(text);
      } catch (error) {
        mainLogger.error('[TTS] Error playing text:', error);
      }
    }

    this.isPlaying = false;
  }

  private async playText(text: string): Promise<void> {
    const apiKey = apiKeyManager.getElevenLabsKey();
    const startedAt = Date.now();
    if (!apiKey) {
      mainLogger.warn('[TTS] No ElevenLabs API key configured');
      cloudLog('WARNING', 'tts_request', {
        textLength: text.length,
        latencyMs: Date.now() - startedAt,
        success: false,
        reason: 'missing_api_key',
      });
      return;
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          speed: 1.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        mainLogger.error('[TTS] ElevenLabs API error:', response.status, errorText);
        cloudLog('ERROR', 'tts_request', {
          textLength: text.length,
          latencyMs: Date.now() - startedAt,
          success: false,
          statusCode: response.status,
          error: errorText,
        });
        return;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const audioBase64 = audioBuffer.toString('base64');
      const id = `tts-${++nextId}`;

      // Send audio to the Sally bar renderer for playback and wait for completion.
      await new Promise<void>((resolve) => {
        this.pendingResolve = resolve;
        this.pendingId = id;
        void this.sendAudioToSallyBar({ audioBase64, id }).catch((error) => {
          mainLogger.error('[TTS] Failed to deliver audio to Sally bar:', error);
          if (this.pendingId === id && this.pendingResolve) {
            this.pendingResolve();
            this.pendingResolve = null;
            this.pendingId = null;
          }
        });

        // Safety timeout in case renderer never responds
        setTimeout(() => {
          if (this.pendingId === id && this.pendingResolve) {
            mainLogger.warn('[TTS] Playback completion timeout for', id);
            this.pendingResolve();
            this.pendingResolve = null;
            this.pendingId = null;
          }
        }, PLAYBACK_TIMEOUT_MS);
      });
      cloudLog('INFO', 'tts_request', {
        textLength: text.length,
        latencyMs: Date.now() - startedAt,
        success: true,
        voiceId: ELEVENLABS_VOICE_ID,
        modelId: ELEVENLABS_MODEL_ID,
      });
    } catch (error) {
      mainLogger.error('[TTS] Failed to synthesize speech:', error);
      cloudLog('ERROR', 'tts_request', {
        textLength: text.length,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendAudioToSallyBar(data: { audioBase64: string; id: string }): Promise<void> {
    const sallyBar = windowManager.showSallyBar();
    if (sallyBar.isDestroyed()) {
      throw new Error('Sally bar window is unavailable');
    }

    if (sallyBar.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        sallyBar.webContents.once('did-finish-load', () => resolve());
      });
    }

    if (sallyBar.isDestroyed()) {
      throw new Error('Sally bar window was destroyed before audio delivery');
    }

    sallyBar.webContents.send('sally:tts-audio', data);
  }
}

export const ttsService = new TtsService();
