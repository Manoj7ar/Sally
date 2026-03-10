// Sally constants

export const GEMINI_MODEL = 'gemini-2.5-flash';

export const CONFIG_WINDOW = {
  width: 700,
  height: 550,
  minWidth: 500,
  minHeight: 400,
};

export const SALLY_BAR = {
  idleWidth: 420,
  idleHeight: 48,
  compactWidth: 280,
  compactHeight: 48,
  composerWidth: 360,
  composerHeight: 124,
  transcriptWidth: 360,
  transcriptHeight: 104,
  topOffset: 16,
};

export const STORE_KEYS = {
  WINDOW_STATE: 'windowState',
  AUDIO_DEVICE: 'audioDevice',
  ANTHROPIC_API_KEY_ENCRYPTED: 'anthropicApiKeyEncrypted',
  OPENAI_API_KEY_ENCRYPTED: 'openaiApiKeyEncrypted',
  ELEVENLABS_API_KEY: 'elevenLabsApiKey',
  WHISPER_API_KEY: 'whisperApiKey',
  PROVIDER: 'provider',
  SOUND_EFFECTS_ENABLED: 'soundEffectsEnabled',
  MIC_MUTED: 'micMuted',
  GEMINI_API_KEY: 'geminiApiKey',
  GEMINI_BACKEND_URL: 'geminiBackendUrl',
  AUTO_RESEARCH_SCREEN_QUESTIONS: 'autoResearchScreenQuestions',
} as const;
