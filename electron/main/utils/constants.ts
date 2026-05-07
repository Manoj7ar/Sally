// Sally constants

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
export const ELEVENLABS_MODEL_ID = 'eleven_turbo_v2_5';

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

/** Safety limits for the Gemini + browser agentic loop (single source of truth for runtime and docs). */
export const AGENT_LOOP = {
  maxIterations: 40,
  maxDurationMs: 10 * 60 * 1000,
} as const;

/** Hard limits on the user-configurable push-to-talk shortcut. */
export const PUSH_TO_TALK = {
  /** Max keys allowed in a combo (modifier(s) + key). */
  maxComboSize: 4,
  /** Auto-cancel a capture session after this long with no activity. */
  captureTimeoutMs: 8_000,
} as const;

export const STORE_KEYS = {
  WINDOW_STATE: 'windowState',
  AUDIO_DEVICE: 'audioDevice',
  ELEVENLABS_API_KEY: 'elevenLabsApiKey',
  PROVIDER: 'provider',
  SOUND_EFFECTS_ENABLED: 'soundEffectsEnabled',
  MIC_MUTED: 'micMuted',
  GEMINI_API_KEY: 'geminiApiKey',
  AUTO_RESEARCH_SCREEN_QUESTIONS: 'autoResearchScreenQuestions',
  OPEN_AT_LOGIN: 'openAtLogin',
  /** uIOhook keycodes that must be held simultaneously to trigger Sally. */
  PUSH_TO_TALK_KEYCODES: 'pushToTalkKeycodes',
} as const;
