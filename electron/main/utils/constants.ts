// Sally constants

export const GEMINI_MODEL = 'gemini-2.5-flash';

export const CONFIG_WINDOW = {
  width: 700,
  height: 550,
  minWidth: 500,
  minHeight: 400,
};

export const BROWSER_WINDOW = {
  width: 1360,
  height: 920,
  minWidth: 1080,
  minHeight: 760,
  chromeHeight: 108,
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
  ELEVENLABS_API_KEY: 'elevenLabsApiKey',
  PROVIDER: 'provider',
  SOUND_EFFECTS_ENABLED: 'soundEffectsEnabled',
  MIC_MUTED: 'micMuted',
  GEMINI_API_KEY: 'geminiApiKey',
  GEMINI_BACKEND_URL: 'geminiBackendUrl',
  AUTO_RESEARCH_SCREEN_QUESTIONS: 'autoResearchScreenQuestions',
  CLOUD_LOGGING_ENABLED: 'cloudLoggingEnabled',
} as const;
