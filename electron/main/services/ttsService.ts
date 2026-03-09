// ElevenLabs TTS service with queued speech — audio played via renderer IPC
import { ipcMain } from 'electron';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { windowManager } from '../windowManager.js';

const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Rachel - clear, calm
const MODEL_ID = 'eleven_turbo_v2_5';
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
        console.error('[TTS] Error playing text:', error);
      }
    }

    this.isPlaying = false;
  }

  private async playText(text: string): Promise<void> {
    const apiKey = apiKeyManager.getElevenLabsKey();
    if (!apiKey) {
      console.warn('[TTS] No ElevenLabs API key configured');
      return;
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          speed: 1.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[TTS] ElevenLabs API error:', response.status, errorText);
        return;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const audioBase64 = audioBuffer.toString('base64');
      const id = `tts-${++nextId}`;

      // Send audio to renderer for playback and wait for completion
      await new Promise<void>((resolve) => {
        this.pendingResolve = resolve;
        this.pendingId = id;
        windowManager.broadcastToAll('sally:tts-audio', { audioBase64, id });

        // Safety timeout in case renderer never responds
        setTimeout(() => {
          if (this.pendingId === id && this.pendingResolve) {
            console.warn('[TTS] Playback completion timeout for', id);
            this.pendingResolve();
            this.pendingResolve = null;
            this.pendingId = null;
          }
        }, PLAYBACK_TIMEOUT_MS);
      });
    } catch (error) {
      console.error('[TTS] Failed to synthesize speech:', error);
    }
  }
}

export const ttsService = new TtsService();
