// Session manager - orchestrates voice -> transcribe -> Electron browser + Gemini agentic loop -> TTS
import { windowManager } from '../windowManager.js';
import { whisperService } from '../services/whisperService.js';
import { ttsService } from '../services/ttsService.js';
import { geminiService } from '../services/geminiService.js';
import { screenshotService } from '../services/screenshotService.js';
import { browserService } from '../services/browserService.js';
import { destinationResolver } from '../services/destinationResolver.js';
import { apiKeyManager } from './apiKeyManager.js';
import type { GeminiAction } from '../services/geminiService.js';
import type { TranscriptionResult } from '../services/whisperService.js';
import type { BrowserSnapshot } from '../services/pageContext.js';
import type { SallyState } from '../../../shared/types.js';

type BrowserAssistiveIntent = 'actions' | 'buttons' | 'fields' | 'errors' | 'links' | 'headings';

const DESCRIBE_COMMANDS = [
  'what do i see',
  'describe screen',
  'describe the screen',
  'where am i',
  'what is on the screen',
  'describe the page',
  'what page am i on',
  'what can i see',
  'read the screen',
  'what am i looking at',
  "what's on the screen",
  "what's on screen",
  'tell me what i am looking at',
  "tell me what i'm looking at",
];

const SUMMARIZE_COMMANDS = [
  'summarize this',
  'summarise this',
  'summarize screen',
  'summarise screen',
  'summarize the screen',
  'summarise the screen',
  'summarize this screen',
  'summarise this screen',
  'summarize this page',
  'summarise this page',
  'summarize what i am seeing',
  "summarize what i'm seeing",
  'summarise what i am seeing',
  "summarise what i'm seeing",
  'summarize what is on my screen',
  "summarize what's on my screen",
  'summarise what is on my screen',
  "summarise what's on my screen",
  'sum this up',
  'sum up this',
];

const DESCRIBE_COMMAND_PATTERNS = [
  /\bwhat am i looking at\b/i,
  /\btell me what (?:i am|i'm) looking at\b/i,
  /\b(?:can you )?tell me more about what (?:i am|i'm) looking at\b/i,
  /\b(?:can you )?tell me about what (?:i am|i'm) looking at\b/i,
  /\bwhat(?:'s| is) on (?:the )?screen\b/i,
  /\bwhat(?:'s| is) on my screen\b/i,
  /\bwhat(?:'s| is) on (?:the )?page\b/i,
  /\bdescribe (?:the )?(?:screen|page)\b/i,
  /\bdescribe my (?:screen|page)\b/i,
  /\bread (?:the )?screen\b/i,
  /\bread my screen\b/i,
  /\bwhat (?:page|screen) am i on\b/i,
  /\bwhat(?:'s| is) going on here\b/i,
  /\bcan you explain what(?:'s| is) on (?:my |the )?(?:screen|page)\b/i,
  /\bcan you tell me what(?:'s| is) on (?:my |the )?(?:screen|page)\b/i,
  /\bcan you describe (?:my |the )?(?:screen|page)\b/i,
];

const SUMMARIZE_COMMAND_PATTERNS = [
  /\bsummari[sz]e (?:this|that)\b/i,
  /\bsummari[sz]e (?:the |this )?(?:screen|page)\b/i,
  /\bsummari[sz]e what (?:i am|i'm) seeing\b/i,
  /\bsummari[sz]e what(?:'s| is) on (?:my |the )?(?:screen|page)\b/i,
  /\b(?:can you )?summari[sz]e (?:this|that)\b/i,
  /\b(?:can you )?summari[sz]e what (?:i am|i'm) seeing\b/i,
  /\b(?:can you )?summari[sz]e what(?:'s| is) on (?:my |the )?(?:screen|page)\b/i,
  /\bsum (?:this|that) up\b/i,
  /\bsum up (?:this|that)\b/i,
];

const SCREEN_QUESTION_PATTERNS = [
  /\bwho is (?:this|that|he|she|they)\b/i,
  /\bwho are (?:these|they)\b/i,
  /\bhow many\b.+\b(people|persons|names|items|faces|errors|tabs|buttons|windows)\b/i,
  /\bcount\b.+\b(people|persons|names|items|faces|errors|tabs|buttons|windows)\b/i,
  /\bwhat names? can you see\b/i,
  /\bwhat does (?:this|that) say\b/i,
  /\bwhat error is (?:this|that)\b/i,
  /\bfind more info about (?:this|that|them|it)\b/i,
  /\btell me more about (?:this|that|them|it)\b/i,
  /\blearn more about (?:this|that|them|it)\b/i,
  /\blook into (?:this|that|them|it)\b/i,
];

const SCREEN_QUESTION_CONTEXT_PATTERN = /\b(this|that|here|these|them|it|screen|page|image|photo|picture|people|persons|names?|name|face|faces|error|code|window)\b/i;
const SCREEN_QUESTION_STARTER_PATTERN = /^(who|what|which|how many|how much|why|when|where|can you|could you|would you)\b/i;
const BROWSER_ASSISTIVE_PATTERNS: Array<{ intent: BrowserAssistiveIntent; patterns: RegExp[] }> = [
  {
    intent: 'actions',
    patterns: [
      /\bwhat can i do here\b/i,
      /\bwhat can i do on (?:this|the) page\b/i,
      /\bwhat can i do on this site\b/i,
      /\bhow can you help here\b/i,
    ],
  },
  {
    intent: 'buttons',
    patterns: [
      /\bwhat buttons are (?:here|on (?:this|the) page)\b/i,
      /\blist the buttons\b/i,
      /\bwhat actions? buttons? can you see\b/i,
    ],
  },
  {
    intent: 'fields',
    patterns: [
      /\bwhat form fields are (?:here|on (?:this|the) page)\b/i,
      /\bwhat fields are (?:here|on (?:this|the) page)\b/i,
      /\bwhat inputs? are (?:here|on (?:this|the) page)\b/i,
      /\bwhat can i fill in\b/i,
    ],
  },
  {
    intent: 'errors',
    patterns: [
      /\bread the errors\b/i,
      /\bwhat errors are (?:here|on (?:this|the) page)\b/i,
      /\bdo you see any errors\b/i,
      /\bwhat messages are on (?:this|the) page\b/i,
    ],
  },
  {
    intent: 'links',
    patterns: [
      /\bwhat links are (?:here|on (?:this|the) page)\b/i,
      /\blist the links\b/i,
    ],
  },
  {
    intent: 'headings',
    patterns: [
      /\bwhat headings are (?:here|on (?:this|the) page)\b/i,
      /\bread the headings\b/i,
      /\bwhat sections are on (?:this|the) page\b/i,
    ],
  },
];

const COMMAND_STARTERS = [
  'what',
  'where',
  'describe',
  'summarize',
  'summarise',
  'read',
  'tell',
  'open',
  'go',
  'search',
  'find',
  'click',
  'press',
  'scroll',
  'turn',
  'switch',
  'set',
  'navigate',
  'fill',
  'select',
  'stop',
  'cancel',
  'help',
  'show',
  'explain',
  'analyze',
  'look',
];

const QUESTION_STYLE_STARTERS = ['what', 'where', 'tell', 'explain', 'analyze', 'look'];

const UNCLEAR_TRANSCRIPT_PATTERNS = [
  /^(?:i am|i'm|im)\b(?! looking\b)/i,
  /^not sure\b/i,
  /^i do(?:n't| do not) know\b/i,
];

const INCOMPLETE_COMMAND_PATTERNS = [
  /^what am$/i,
  /^what am i$/i,
  /^what(?:'s| is)?$/i,
  /^what(?:'s| is) the$/i,
  /^describe$/i,
  /^summari[sz]e$/i,
  /^tell me$/i,
  /^can you$/i,
  /^open$/i,
  /^search$/i,
  /^click$/i,
  /^go$/i,
];

// Smart home command patterns → rewritten as browser instructions
const SMART_HOME_PATTERNS: Array<{ pattern: RegExp; rewrite: (match: RegExpMatchArray) => string }> = [
  // Lights
  {
    pattern: /\b(?:turn\s+(?:on|off)|switch\s+(?:on|off))\s+(?:the\s+)?(?:(.+?)\s+)?lights?\b/i,
    rewrite: (m) => {
      const onOff = m[0].match(/\bon\b/i) ? 'on' : 'off';
      const room = m[1] ? m[1].trim() : '';
      return `Go to home.google.com, find the ${room ? room + ' ' : ''}light${room ? '' : 's'}, and turn ${onOff === 'on' ? 'it' : 'them'} ${onOff}.`;
    },
  },
  {
    pattern: /\blights?\s+(on|off)\b/i,
    rewrite: (m) => `Go to home.google.com, find the lights, and turn them ${m[1].toLowerCase()}.`,
  },
  // Thermostat / temperature
  {
    pattern: /\b(?:set|change)\s+(?:the\s+)?(?:thermostat|temperature|temp)\s+(?:to\s+)?(\d+)/i,
    rewrite: (m) => `Go to home.google.com, find the thermostat, and set the temperature to ${m[1]} degrees.`,
  },
  // Fan
  {
    pattern: /\b(?:turn\s+(?:on|off)|switch\s+(?:on|off))\s+(?:the\s+)?(?:(.+?)\s+)?fan\b/i,
    rewrite: (m) => {
      const onOff = m[0].match(/\bon\b/i) ? 'on' : 'off';
      const room = m[1] ? m[1].trim() + ' ' : '';
      return `Go to home.google.com, find the ${room}fan, and turn it ${onOff}.`;
    },
  },
  // Generic device on/off
  {
    pattern: /\b(?:turn\s+(on|off)|switch\s+(on|off))\s+(?:the\s+)?(.+)/i,
    rewrite: (m) => {
      const onOff = (m[1] || m[2]).toLowerCase();
      const device = m[3].trim();
      return `Go to home.google.com, find "${device}", and turn it ${onOff}.`;
    },
  },
];

const MAX_ITERATIONS = 15;
const MAX_DURATION_MS = 3 * 60 * 1000; // 3 minutes
const SETTLE_DELAY_MIN_MS = 800;

class SessionManager {
  private state: SallyState = 'idle';
  private isCancelled = false;
  private runGeneration = 0;
  private waitTimeout: NodeJS.Timeout | null = null;

  initialize(): void {
    console.log('[SessionManager] Initialized (Electron browser + Gemini agentic mode)');
  }

  private clearWaitTimeout(): void {
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
  }

  private startRun(): number {
    this.runGeneration += 1;
    this.isCancelled = false;
    this.clearWaitTimeout();
    return this.runGeneration;
  }

  private invalidateRun(): number {
    this.runGeneration += 1;
    this.isCancelled = true;
    this.clearWaitTimeout();
    return this.runGeneration;
  }

  private isRunCurrent(runId: number): boolean {
    return runId === this.runGeneration && !this.isCancelled;
  }

  private isDescribeCommand(text: string): boolean {
    if (DESCRIBE_COMMANDS.some((cmd) => text.includes(cmd))) {
      return true;
    }

    return DESCRIBE_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
  }

  private isSummarizeCommand(text: string): boolean {
    if (SUMMARIZE_COMMANDS.some((cmd) => text.includes(cmd))) {
      return true;
    }

    return SUMMARIZE_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
  }

  private normalizeBrowserAssistiveIntent(text: string): BrowserAssistiveIntent | null {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (this.isSummarizeCommand(normalized) || this.isDescribeCommand(normalized)) {
      return null;
    }

    if (this.normalizeScreenQuestionIntent(normalized)) {
      return null;
    }

    const match = BROWSER_ASSISTIVE_PATTERNS.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)));
    return match?.intent || null;
  }

  private normalizeSummarizeIntent(text: string): string | null {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (this.isSummarizeCommand(normalized)) {
      return text.trim();
    }

    const asksForSummary = /\b(summari[sz]e|summary|sum up)\b/i.test(normalized);
    const mentionsScreenContext = /\b(screen|page|window|this|that|what i am seeing|what i'm seeing)\b/i.test(normalized);
    if (asksForSummary && mentionsScreenContext) {
      return 'summarize this';
    }

    return null;
  }

  private normalizeScreenQuestionIntent(text: string): string | null {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (this.isSummarizeCommand(normalized) || this.isDescribeCommand(normalized)) {
      return null;
    }

    const isExplicitBrowserCommand = /^(open|go|search|click|press|scroll|navigate|fill|select|show)\b/i.test(normalized);
    if (isExplicitBrowserCommand || this.expandSmartCommand(normalized) !== normalized) {
      return null;
    }

    if (BROWSER_ASSISTIVE_PATTERNS.some(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))) {
      return null;
    }

    if (SCREEN_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return text.trim();
    }

    if (SCREEN_QUESTION_STARTER_PATTERN.test(normalized) && SCREEN_QUESTION_CONTEXT_PATTERN.test(normalized)) {
      return text.trim();
    }

    return null;
  }

  private normalizeDescribeIntent(text: string): string | null {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (this.isDescribeCommand(normalized)) {
      return text.trim();
    }

    const mentionsScreenContext = /\b(screen|page|window|code|editor|error)\b/i.test(normalized);
    const asksForDescription = /\b(what|describe|read|tell|explain|analyze|look)\b/i.test(normalized);
    if (mentionsScreenContext && asksForDescription) {
      return 'what am i looking at';
    }

    return null;
  }

  private isLikelyActionableVoiceCommand(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    if (this.normalizeSummarizeIntent(normalized)) {
      return true;
    }

    if (this.normalizeBrowserAssistiveIntent(normalized)) {
      return true;
    }

    if (this.normalizeScreenQuestionIntent(normalized)) {
      return true;
    }

    if (this.normalizeDescribeIntent(normalized)) {
      return true;
    }

    if (INCOMPLETE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (normalized.includes('cancel')) {
      return true;
    }

    if (UNCLEAR_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (this.expandSmartCommand(normalized) !== normalized) {
      return true;
    }

    if (QUESTION_STYLE_STARTERS.some((starter) => normalized === starter || normalized.startsWith(`${starter} `))) {
      return false;
    }

    if (COMMAND_STARTERS.some((starter) => normalized === starter || normalized.startsWith(`${starter} `))) {
      return true;
    }

    return /\b(screen|page|browser|google|chrome|tab|button|link|lights?|fan|thermostat|temperature|site|website)\b/i.test(normalized);
  }

  private resolveVoiceInstruction(text: string): string | null {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return null;
    }

    const normalizedSummarizeIntent = this.normalizeSummarizeIntent(trimmed);
    if (normalizedSummarizeIntent) {
      return normalizedSummarizeIntent;
    }

    if (this.normalizeBrowserAssistiveIntent(trimmed)) {
      return trimmed;
    }

    const normalizedScreenQuestionIntent = this.normalizeScreenQuestionIntent(trimmed);
    if (normalizedScreenQuestionIntent) {
      return normalizedScreenQuestionIntent;
    }

    const normalizedDescribeIntent = this.normalizeDescribeIntent(trimmed);
    if (normalizedDescribeIntent) {
      return normalizedDescribeIntent;
    }

    if (!this.isLikelyActionableVoiceCommand(trimmed)) {
      return null;
    }

    return trimmed;
  }

  private isBusyState(): boolean {
    return this.state === 'processing'
      || this.state === 'acting'
      || this.state === 'speaking'
      || this.state === 'awaiting_response';
  }

  beginListeningFromHotkey(): void {
    if (this.isBusyState()) {
      this.invalidateRun();
    } else {
      this.clearWaitTimeout();
    }

    ttsService.stop();
    windowManager.setBorderOverlayTargetToCursor();
    this.setState('listening');
  }

  private async syncOverlayTargetFromBrowser(runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;

    const bounds = await browserService.getBrowserWindowBounds().catch((error) => {
      console.warn('[SessionManager] Failed to sync browser display target:', error);
      return null;
    });

    if (!this.isRunCurrent(runId)) return;
    windowManager.setBorderOverlayTargetByBounds(bounds);
  }

  private async getCurrentPageInfo(): Promise<{ url?: string; title?: string } | null> {
    try {
      return await browserService.getPageInfo();
    } catch {
      return null;
    }
  }

  private async deriveInitialBrowserUrl(instruction: string): Promise<string | null> {
    const trimmed = instruction.trim();
    if (!trimmed) {
      return null;
    }

    const explicitUrl = trimmed.match(/\bhttps?:\/\/[^\s]+/i)?.[0];
    if (explicitUrl) {
      return explicitUrl;
    }

    const domainLike = trimmed.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i)?.[0];
    if (domainLike) {
      return domainLike.startsWith('http') ? domainLike : `https://${domainLike}`;
    }

    const openLike = trimmed.match(/^(?:open|go to|navigate to|visit|take me to|bring me to)\s+(.+)$/i);
    if (openLike?.[1]) {
      const resolved = await destinationResolver.resolveNavigationTarget(openLike[1].trim());
      if (resolved.via !== 'search') {
        console.log('[SessionManager] Resolved destination:', openLike[1].trim(), '->', resolved.url);
      }
      return resolved.url;
    }

    const searchLike = trimmed.match(/^(?:search(?: for)?|find|look up|lookup|research)\s+(.+)$/i);
    if (searchLike?.[1]) {
      return destinationResolver.buildSearchUrl(searchLike[1].trim());
    }

    return null;
  }

  async handleTranscription(audioBase64: string, mimeType: string, durationMs?: number): Promise<string> {
    const runId = this.startRun();
    this.setState('processing');

    try {
      if (!this.isRunCurrent(runId)) {
        return '';
      }

      if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasWhisperKey()) {
        if (!this.isRunCurrent(runId)) {
          return '';
        }
        ttsService.speakImmediate('Please configure a Gemini API key or OpenAI Whisper key in settings for speech transcription.');
        if (this.isRunCurrent(runId)) {
          this.setState('idle');
        }
        return '';
      }

      const transcription = await whisperService.transcribe(audioBase64, mimeType, { durationMs });
      if (!this.isRunCurrent(runId)) {
        return '';
      }
      this.logTranscription(transcription);

      if (!transcription.transcript.trim()) {
        if (this.isRunCurrent(runId)) {
          ttsService.speakImmediate('Do you need help with anything else?');
          this.setState('idle');
        }
        return '';
      }

      if (transcription.intent === 'cancel') {
        if (!this.isRunCurrent(runId)) {
          return transcription.canonicalCommand;
        }
        await this.cancel();
        return transcription.canonicalCommand;
      }

      if (transcription.confidence !== 'high' || !transcription.canonicalCommand) {
        if (this.isRunCurrent(runId)) {
          ttsService.speakImmediate("I didn't catch that clearly. Please say it again.");
          this.setState('idle');
        }
        return '';
      }

      const resolvedInstruction = this.resolveVoiceInstruction(transcription.canonicalCommand);
      if (!resolvedInstruction) {
        if (this.isRunCurrent(runId)) {
          ttsService.speakImmediate("I didn't catch that clearly. Please say it again.");
          this.setState('idle');
        }
        return '';
      }

      if (resolvedInstruction !== transcription.transcript) {
        console.log('[SessionManager] Resolved voice intent:', transcription.transcript, '->', resolvedInstruction);
      }

      this.executeTaskForRun(resolvedInstruction, runId).catch((error) => {
        if (!this.isRunCurrent(runId)) {
          return;
        }
        console.error('[SessionManager] Task execution failed:', error);
        ttsService.speakImmediate('Something went wrong. Please try again.');
        this.setState('idle');
      });

      return resolvedInstruction;
    } catch (error) {
      if (!this.isRunCurrent(runId)) {
        return '';
      }
      console.error('[SessionManager] Transcription failed:', error);
      ttsService.speakImmediate("I couldn't understand that, please try again.");
      this.setState('idle');
      return '';
    }
  }

  async executeTask(text: string): Promise<void> {
    ttsService.stop();
    const runId = this.startRun();
    await this.executeTaskForRun(text, runId);
  }

  async handleSilence(details?: { durationMs?: number; peakLevel?: number; averageLevel?: number }): Promise<void> {
    const runId = this.startRun();
    this.setState('processing');

    console.log('[SessionManager] Ignoring silent voice input:', {
      durationMs: details?.durationMs ?? 0,
      peakLevel: details?.peakLevel ?? 0,
      averageLevel: details?.averageLevel ?? 0,
    });

    if (!this.isRunCurrent(runId)) {
      return;
    }

    ttsService.speakImmediate('Do you need help with anything else?');
    if (this.isRunCurrent(runId)) {
      this.setState('idle');
    }
  }

  private async executeTaskForRun(text: string, runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;

    const normalizedText = text.toLowerCase().trim();
    const isSummarizeCommand = this.isSummarizeCommand(normalizedText);
    const isDescribeCommand = this.isDescribeCommand(normalizedText);
    const browserAssistiveIntent = this.normalizeBrowserAssistiveIntent(text);
    const screenQuestionIntent = this.normalizeScreenQuestionIntent(text);

    if (isSummarizeCommand) {
      await this.summarizeScreen(runId);
      return;
    }

    if (isDescribeCommand) {
      await this.describeScreen(runId);
      return;
    }

    if (screenQuestionIntent) {
      await this.answerScreenQuestion(screenQuestionIntent, runId);
      return;
    }

    if (browserAssistiveIntent) {
      await this.handleAssistiveBrowserCommand(browserAssistiveIntent, runId);
      return;
    }

    // Check for smart home commands and rewrite them as browser instructions
    const expanded = this.expandSmartCommand(text);
    if (expanded !== text) {
      console.log('[SessionManager] Smart command expanded:', text, '→', expanded);
    }

    await this.agenticBrowse(expanded, runId);
  }

  private expandSmartCommand(text: string): string {
    for (const { pattern, rewrite } of SMART_HOME_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return rewrite(match);
      }
    }
    return text;
  }

  async previewTranscription(audioBase64: string, mimeType: string, durationMs?: number): Promise<string> {
    try {
      if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasWhisperKey()) {
        return '';
      }

      const transcription = await whisperService.transcribe(audioBase64, mimeType, { durationMs, isPreview: true });
      if (transcription.confidence === 'high' && transcription.canonicalCommand) {
        console.log('[SessionManager] Live preview transcription:', transcription.canonicalCommand);
        return transcription.canonicalCommand;
      }
      return '';
    } catch (error) {
      console.warn('[SessionManager] Live preview transcription failed:', error);
      return '';
    }
  }

  private logTranscription(transcription: TranscriptionResult): void {
    console.log('[SessionManager] Transcribed:', transcription.transcript, {
      canonicalCommand: transcription.canonicalCommand,
      intent: transcription.intent,
      confidence: transcription.confidence,
      source: transcription.source,
    });
  }

  async describeScreen(runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;
    this.setState('acting');
    try {
      if (!this.isRunCurrent(runId)) return;
      ttsService.speakImmediate('Let me take a look...');
      const targetDisplayId = windowManager.getBorderOverlayDisplayId();
      const screenshot = await screenshotService.captureScreen(targetDisplayId);
      if (!this.isRunCurrent(runId)) return;
      const result = await geminiService.interpretScreen({
        screenshot,
        instruction: 'The user wants a screen description only. Do not browse, navigate, click, or suggest opening a browser. Look at this screenshot, identify what app or page is visible, summarize the main content in 2 to 3 natural spoken sentences, and if helpful end with a short offer like "Want me to help further with this?" Set action to null.',
      });
      if (!this.isRunCurrent(runId)) return;
      ttsService.speak(result.narration);
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] describeScreen failed:', error);
      ttsService.speakImmediate("Sorry, I couldn't see the screen right now. Check your Gemini API key in settings.");
    } finally {
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
    }
  }

  async summarizeScreen(runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;
    this.setState('acting');
    try {
      if (!this.isRunCurrent(runId)) return;
      ttsService.speakImmediate('Let me summarize that...');
      const targetDisplayId = windowManager.getBorderOverlayDisplayId();
      const screenshot = await screenshotService.captureScreen(targetDisplayId);
      if (!this.isRunCurrent(runId)) return;
      const result = await geminiService.interpretScreen({
        screenshot,
        instruction: 'The user wants a concise summary of what is visible on screen. Do not browse, navigate, click, or suggest opening a browser. Look at this screenshot, read the clearly visible text, identify the main subject, and summarize the important information in 2 to 4 natural spoken sentences. If there is only a small amount of readable text, briefly summarize what is visible and say that only limited text is readable. Set action to null.',
      });
      if (!this.isRunCurrent(runId)) return;
      ttsService.speak(result.narration);
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] summarizeScreen failed:', error);
      ttsService.speakImmediate("Sorry, I couldn't summarize the screen right now. Check your Gemini API key in settings.");
    } finally {
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
    }
  }

  async answerScreenQuestion(question: string, runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;

    if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasGeminiBackendUrl()) {
      ttsService.speakImmediate('I need Gemini vision configured to answer screen questions. Add a Gemini API key or Sally Vision Backend URL in settings.');
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
      return;
    }

    this.setState('acting');
    let handedOffToResearch = false;

    try {
      if (!this.isRunCurrent(runId)) return;
      ttsService.speakImmediate('Let me check that...');
      const browserSnapshot = browserService.isRunning()
        ? await this.captureActiveBrowserSnapshot(runId)
        : null;
      if (!this.isRunCurrent(runId)) return;

      const targetDisplayId = windowManager.getBorderOverlayDisplayId();
      const screenshot = browserSnapshot
        ? browserSnapshot.screenshot
        : await screenshotService.captureScreen(targetDisplayId);
      if (!this.isRunCurrent(runId)) return;

      const pageInfo = browserSnapshot
        ? { url: browserSnapshot.pageUrl, title: browserSnapshot.pageTitle }
        : await this.getCurrentPageInfo();
      const autoResearchEnabled = apiKeyManager.getAutoResearchScreenQuestions();
      const result = await geminiService.answerScreenQuestion({
        screenshot,
        question,
        pageUrl: pageInfo?.url,
        pageTitle: pageInfo?.title,
        autoResearchEnabled,
        pageContext: browserSnapshot?.pageContext,
        sourceMode: browserSnapshot?.sourceMode,
      });
      if (!this.isRunCurrent(runId)) return;

      if (autoResearchEnabled && result.shouldResearch && result.researchQuery) {
        await ttsService.speakImmediate(`${result.answer} I'll look up a bit more.`);
        if (!this.isRunCurrent(runId)) return;
        handedOffToResearch = true;
        await this.agenticBrowse(
          `Open Google and search for "${result.researchQuery}". Summarize the most relevant result for the user's question: "${question}".`,
          runId,
          { skipIntro: true },
        );
        return;
      }

      await ttsService.speakImmediate(result.answer);
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] answerScreenQuestion failed:', error);
      ttsService.speakImmediate("Sorry, I couldn't answer that from the screen right now. Check your Gemini API key in settings.");
    } finally {
      if (this.isRunCurrent(runId) && !handedOffToResearch) {
        this.setState('idle');
      }
    }
  }

  private async captureActiveBrowserSnapshot(runId: number): Promise<BrowserSnapshot | null> {
    if (!this.isRunCurrent(runId)) return null;

    try {
      const snapshot = await Promise.race([
        browserService.captureBrowserSnapshot(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Browser snapshot timeout')), 15_000)),
      ]);
      return snapshot;
    } catch (error) {
      if (this.isRunCurrent(runId)) {
        console.error('[SessionManager] Failed to capture browser snapshot:', error);
      }
      return null;
    }
  }

  private summarizeInteractiveNames(
    snapshot: BrowserSnapshot,
    roles: string[],
    fallbackKey: 'label' | 'text' = 'label',
  ): string[] {
    return snapshot.pageContext.interactiveElements
      .filter((element) => roles.includes(element.role))
      .map((element) => {
        const descriptor = element[fallbackKey] || element.text || element.placeholder || element.tagName;
        return `${element.index}. ${descriptor}`.trim();
      })
      .filter(Boolean)
      .slice(0, 6);
  }

  private formatSpokenList(items: string[]): string {
    if (items.length === 0) {
      return '';
    }

    if (items.length === 1) {
      return items[0];
    }

    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }

    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  private buildAssistiveBrowserResponse(intent: BrowserAssistiveIntent, snapshot: BrowserSnapshot): string {
    const buttons = this.summarizeInteractiveNames(snapshot, ['button', 'tab', 'menuitem'], 'label');
    const links = this.summarizeInteractiveNames(snapshot, ['link'], 'label');
    const fields = this.summarizeInteractiveNames(snapshot, ['textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch'], 'label');
    const headings = snapshot.pageContext.headings.slice(0, 5);
    const errors = snapshot.pageContext.visibleMessages.slice(0, 4);
    const pageName = snapshot.pageTitle || snapshot.pageUrl || 'this page';

    switch (intent) {
      case 'buttons':
        return buttons.length > 0
          ? `On ${pageName}, I can see these buttons: ${this.formatSpokenList(buttons)}.`
          : `I do not see any clear buttons on ${pageName} right now.`;

      case 'fields':
        return fields.length > 0
          ? `I can fill these visible fields on ${pageName}: ${this.formatSpokenList(fields)}.`
          : `I do not see any obvious form fields on ${pageName} right now.`;

      case 'errors':
        return errors.length > 0
          ? `Here are the visible messages I can read: ${this.formatSpokenList(errors)}.`
          : 'I do not see any obvious error or status messages on this page right now.';

      case 'links':
        return links.length > 0
          ? `The main links I can see are ${this.formatSpokenList(links)}.`
          : `I do not see many clear links on ${pageName} right now.`;

      case 'headings':
        return headings.length > 0
          ? `The visible sections on ${pageName} are ${this.formatSpokenList(headings)}.`
          : `I do not see any clear headings on ${pageName} right now.`;

      case 'actions':
      default: {
        const parts: string[] = [];
        if (fields.length > 0) {
          parts.push(`I can fill ${this.formatSpokenList(fields.slice(0, 3))}`);
        }
        if (buttons.length > 0) {
          parts.push(`use buttons like ${this.formatSpokenList(buttons.slice(0, 3))}`);
        }
        if (links.length > 0) {
          parts.push(`open links such as ${this.formatSpokenList(links.slice(0, 3))}`);
        }
        if (errors.length > 0) {
          parts.push(`and I can read messages like ${this.formatSpokenList(errors.slice(0, 2))}`);
        }

        if (parts.length === 0) {
          return snapshot.pageContext.semanticSummary
            ? `Here is what I can tell from the page: ${snapshot.pageContext.semanticSummary}.`
            : `I can inspect this page further, but I do not see many obvious visible controls on ${pageName} yet.`;
        }

        return `On ${pageName}, ${parts.join(', ')}.`;
      }
    }
  }

  private async handleAssistiveBrowserCommand(intent: BrowserAssistiveIntent, runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;

    if (!browserService.isRunning()) {
      ttsService.speakImmediate('Open a page with Sally first, then I can walk you through its controls.');
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
      return;
    }

    this.setState('acting');

    try {
      await this.syncOverlayTargetFromBrowser(runId);
      const snapshot = await this.captureActiveBrowserSnapshot(runId);
      if (!snapshot || !this.isRunCurrent(runId)) {
        return;
      }

      const response = this.buildAssistiveBrowserResponse(intent, snapshot);
      windowManager.broadcastToAll('sally:chat', {
        role: 'assistant',
        text: response,
      });
      await ttsService.speakImmediate(response);
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] handleAssistiveBrowserCommand failed:', error);
      ttsService.speakImmediate("I couldn't inspect this page right now. Please try again.");
    } finally {
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
    }
  }

  private async agenticBrowse(
    instruction: string,
    runId: number,
    options: { skipIntro?: boolean } = {},
  ): Promise<void> {
    if (!this.isRunCurrent(runId)) return;

    if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasGeminiBackendUrl()) {
      if (!this.isRunCurrent(runId)) return;
      ttsService.speakImmediate("I need Gemini vision configured to browse. Add a Gemini API key or Sally Vision Backend URL in settings.");
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
      return;
    }

    this.setState('acting');

    const startTime = Date.now();
    const history: string[] = [];

    try {
      if (!this.isRunCurrent(runId)) return;
      if (!options.skipIntro) {
        ttsService.speakImmediate("On it! Let me handle that for you.");
      }

      const initialUrl = await this.deriveInitialBrowserUrl(instruction);
      await browserService.launch(initialUrl || undefined);
      const launchNotice = browserService.consumeLaunchNotice();
      if (launchNotice) {
        await ttsService.speakImmediate(launchNotice);
      }
      await this.syncOverlayTargetFromBrowser(runId);

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Check cancellation
        if (!this.isRunCurrent(runId)) {
          console.log('[SessionManager] Agentic loop cancelled at iteration', i);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > MAX_DURATION_MS) {
          console.log('[SessionManager] Agentic loop timed out');
          ttsService.speak("This is taking a while, so I'll stop here. You can try again with a simpler request.");
          break;
        }

        console.log(`[SessionManager] Agentic loop iteration ${i + 1}/${MAX_ITERATIONS}`);
        await this.syncOverlayTargetFromBrowser(runId);
        if (!this.isRunCurrent(runId)) return;

        let snapshot: BrowserSnapshot | null;
        try {
          snapshot = await this.captureActiveBrowserSnapshot(runId);
        } catch {
          snapshot = null;
        }

        if (!snapshot) {
          if (!this.isRunCurrent(runId)) return;
          history.push('FAILED: Could not capture screen (page unresponsive)');
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        let result: import('../services/geminiService.js').GeminiInterpretResult;
        try {
          result = await Promise.race([
            geminiService.interpretScreen({
              screenshot: snapshot.screenshot,
              instruction,
              history,
              pageUrl: snapshot.pageUrl,
              pageTitle: snapshot.pageTitle,
              pageContext: snapshot.pageContext,
              sourceMode: snapshot.sourceMode,
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 30_000)),
          ]);
        } catch (e) {
          if (!this.isRunCurrent(runId)) return;
          console.error('[SessionManager] Gemini call failed:', e);
          history.push('FAILED: Gemini error — retrying with fresh screenshot');
          continue;
        }
        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Gemini result:', result.narration, result.action);

        // Broadcast to UI
        windowManager.broadcastToAll('sally:chat', {
          role: 'assistant',
          text: result.narration,
        });

        // Narrate what Gemini sees
        if (result.narration) {
          ttsService.speak(result.narration);
        }

        // If no action needed, task is complete
        if (!result.action || result.action.type === 'null') {
          console.log('[SessionManager] Agentic loop complete — no more actions');
          break;
        }

        // Check cancellation before executing
        if (!this.isRunCurrent(runId)) return;

        // Execute the action
        const actionResult = await browserService.executeAction(result.action);
        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Action result:', actionResult);

        // Include success/failure status so Gemini can adapt
        const SUCCESS_PREFIXES = ['Navigated to', 'Clicked', 'Typed', 'Selected', 'Pressed', 'Hovered', 'Focused', 'Checked', 'Unchecked', 'Scrolled', 'Went back', 'Waited'];
        const succeeded = SUCCESS_PREFIXES.some(p => actionResult.startsWith(p));
        const actionDesc = this.describeAction(result.action, actionResult);
        history.push(succeeded ? actionDesc : `FAILED: ${actionDesc}`);
        if (history.length > 10) history.shift();

        windowManager.broadcastToAll('sally:step', {
          action: result.action.type,
          details: actionResult,
          timestamp: Date.now(),
        });

        // Smart page settle: wait for network idle, with min/max bounds
        await this.waitForSettle(result.action.type, runId);
      }
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] Agentic browse failed:', error);
      ttsService.stop();
      ttsService.speakImmediate("Something went wrong. Let me know if you'd like to try again.");
    } finally {
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
    }
  }

  private async waitForSettle(actionType: string, runId: number): Promise<void> {
    if (!this.isRunCurrent(runId)) return;
    try {
      await browserService.waitForSettle(actionType);
    } catch {
      await new Promise(resolve => setTimeout(resolve, SETTLE_DELAY_MIN_MS));
    }
  }

  private describeAction(action: GeminiAction, result: string): string {
    switch (action.type) {
      case 'navigate': return `Navigated to ${action.url}`;
      case 'click': return `Clicked "${action.selector}" — ${result}`;
      case 'fill': return `Filled "${action.selector}" with "${action.value}"`;
      case 'type': return `Typed "${action.value}"`;
      case 'select': return `Selected "${action.value}" in "${action.selector}"`;
      case 'press': return `Pressed ${action.value || 'Enter'}`;
      case 'hover': return `Hovered over "${action.selector}"`;
      case 'focus': return `Focused "${action.selector}"`;
      case 'check': return `Checked "${action.selector}"`;
      case 'uncheck': return `Unchecked "${action.selector}"`;
      case 'scroll': return 'Scrolled down';
      case 'scroll_up': return 'Scrolled up';
      case 'back': return 'Went back to previous page';
      case 'wait': return `Waited ${action.value || '2000'}ms`;
      default: return `${action.type}: ${result}`;
    }
  }

  async cancel(): Promise<void> {
    this.invalidateRun();
    ttsService.stop();
    ttsService.speakImmediate('Cancelled.');
    windowManager.hideSallyBar();
    this.setState('idle');
  }

  setState(state: SallyState): void {
    this.state = state;
    if (state === 'idle') {
      windowManager.hideBorderOverlay();
    } else {
      windowManager.showSallyBar();
      if (state === 'awaiting_response') {
        windowManager.hideBorderOverlay();
      } else {
        windowManager.showBorderOverlay();
      }
    }
    windowManager.broadcastToAll('sally:state-changed', { state });
  }

  getState(): SallyState {
    return this.state;
  }

  setListening(): void {
    this.clearWaitTimeout();
    this.setState('listening');
  }

  setIdle(): void {
    this.clearWaitTimeout();
    this.setState('idle');
  }
}

export const sessionManager = new SessionManager();
