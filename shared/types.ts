// Sally shared types

export type SallyProvider = 'gemini';
export type SallyState = 'idle' | 'listening' | 'processing' | 'acting' | 'speaking' | 'awaiting_response';
export type SallyBarLayout = 'idle' | 'compact' | 'composer' | 'transcript';
export type SilenceMode = 'default' | 'confirmation';

export interface AutomationStep {
  action: string;
  details: string;
  timestamp: number;
}

export interface ChatMessage {
  role: 'assistant' | 'user' | 'tool';
  text: string;
  isError?: boolean;
  isStreaming?: boolean;
}

export interface OverlayHighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayBorderPayload {
  mode: 'border';
}

export interface OverlayTargetPayload {
  mode: 'target';
  label?: string | null;
  rect?: OverlayHighlightRect | null;
}

export interface OverlayWaitingPayload {
  mode: 'waiting';
  message: string;
  actionLabel?: string | null;
}

export type OverlayHighlightPayload =
  | OverlayBorderPayload
  | OverlayTargetPayload
  | OverlayWaitingPayload;

export interface SallyConfig {
  provider: SallyProvider;
  hasProviderKey: boolean;
  hasElevenLabsKey: boolean;
  hasGeminiKey: boolean;
  geminiBackendUrl: string;
  autoResearchScreenQuestions: boolean;
  audioDevice: string;
}

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
}

export interface AutoConfirmationListenPayload {
  maxDurationMs: number;
  trailingSilenceMs: number;
}

// IPC Channel definitions
export interface IpcChannels {
  // Config
  'sally:get-config': { request: void; response: SallyConfig; broadcast: never };
  'sally:set-provider': { request: SallyProvider; response: void; broadcast: never };
  'sally:get-provider': { request: void; response: SallyProvider; broadcast: never };
  'sally:set-api-key': { request: { provider: SallyProvider; key: string }; response: void; broadcast: never };
  'sally:test-api-key': { request: { provider: SallyProvider; key: string }; response: boolean; broadcast: never };
  'sally:clear-api-key': { request: void; response: void; broadcast: never };
  'sally:set-elevenlabs-key': { request: string; response: void; broadcast: never };
  'sally:get-elevenlabs-key-status': { request: void; response: boolean; broadcast: never };
  'sally:set-gemini-key': { request: string; response: void; broadcast: never };
  'sally:get-gemini-key-status': { request: void; response: boolean; broadcast: never };
  'sally:set-gemini-backend-url': { request: string; response: void; broadcast: never };
  'sally:get-gemini-backend-url': { request: void; response: string; broadcast: never };
  'sally:set-auto-research-screen-questions': { request: boolean; response: void; broadcast: never };
  'sally:get-auto-research-screen-questions': { request: void; response: boolean; broadcast: never };
  'sally:set-audio-device': { request: string; response: void; broadcast: never };
  'sally:get-audio-device': { request: void; response: string; broadcast: never };

  // Voice flow
  'sally:transcribe': { request: { audioBase64: string; mimeType: string; durationMs?: number }; response: string; broadcast: never };
  'sally:preview-transcription': { request: { audioBase64: string; mimeType: string; durationMs?: number }; response: string; broadcast: never };
  'sally:handle-silence': { request: { durationMs?: number; peakLevel?: number; averageLevel?: number; mode?: SilenceMode }; response: void; broadcast: never };
  'sally:send-instruction': { request: string; response: void; broadcast: never };
  'sally:cancel': { request: void; response: void; broadcast: never };
  'sally:get-mic-muted': { request: void; response: boolean; broadcast: never };
  'sally:set-mic-muted': { request: boolean; response: boolean; broadcast: never };

  // External
  'sally:open-external': { request: string; response: void; broadcast: never };

  // Window
  'window:show-config': { request: void; response: void; broadcast: never };
  'window:set-pill-layout': { request: { layout: SallyBarLayout }; response: void; broadcast: never };
  'window:hide-pill': { request: void; response: void; broadcast: never };
  'window:show-pill': { request: void; response: void; broadcast: never };

  // Broadcasts (main -> renderer)
  'sally:state-changed': { request: never; response: never; broadcast: { state: SallyState; text?: string } };
  'sally:step': { request: never; response: never; broadcast: AutomationStep };
  'sally:chat': { request: never; response: never; broadcast: ChatMessage };
  'sally:overlay-highlight': { request: never; response: never; broadcast: OverlayHighlightPayload };
  'sally:overlay-clear': { request: never; response: never; broadcast: void };
  'sally:auto-confirmation-listen': { request: never; response: never; broadcast: AutoConfirmationListenPayload };
  'sally:auto-confirmation-stop': { request: never; response: never; broadcast: void };
  'sally:tts-audio': { request: never; response: never; broadcast: { audioBase64: string; id: string } };
  'sally:tts-stop': { request: never; response: never; broadcast: void };
  'sally:tts-playback-error': { request: { id: string; message: string }; response: never; broadcast: never };
  'sally:mic-muted-changed': { request: never; response: never; broadcast: { muted: boolean } };

  // Hotkey events (main -> sally bar)
  'hotkey:start-recording': { request: never; response: never; broadcast: void };
  'hotkey:stop-recording': { request: never; response: never; broadcast: void };
  'hotkey:cancel-recording': { request: never; response: never; broadcast: void };
}

// Type helpers
export type IpcRequest<T extends keyof IpcChannels> = IpcChannels[T]['request'];
export type IpcResponse<T extends keyof IpcChannels> = IpcChannels[T]['response'];
export type IpcBroadcast<T extends keyof IpcChannels> = IpcChannels[T]['broadcast'];

// Window.electron type augmentation
declare global {
  interface Window {
    electron: {
      invoke<T>(channel: string, data?: unknown): Promise<T>;
      send(channel: string, data?: unknown): void;
      on(channel: string, callback: (event: unknown, data: unknown) => void): () => void;
      once(channel: string, callback: (event: unknown, data: unknown) => void): void;
      removeAllListeners(channel: string): void;
      platform: NodeJS.Platform;
    };
  }
}
