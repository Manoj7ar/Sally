// Audio transcription service - Gemini 2.5 Flash transcription and command recovery
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';
import { mainLogger } from '../utils/logger.js';

const TRANSCRIPTION_PROMPT = [
  'Transcribe exactly the words actually spoken in this audio recording.',
  'This audio is usually a short spoken command to Sally, a desktop accessibility assistant.',
  'Preserve the full command, including short leading words such as what, where, can you, tell me, describe, summarize, summarise, open, go to, navigate to, visit, take me to, search, click, read, turn, set, stop, or cancel.',
  'If the audio is silent, unclear, partial, or you are not confident, return an empty string.',
  'Do not guess, summarize, paraphrase, continue sentences, or answer the user.',
  'Do not repeat these instructions.',
  'Output only the spoken words with no labels or commentary.',
].join(' ');

const COMMAND_RECOVERY_PROMPT = [
  'This audio is a short voice command for Sally, a desktop accessibility assistant.',
  'Recover the exact spoken command only if you are confident.',
  'Common commands include "go to Gmail", "open Canva", "take me to Notion", "search for Gemini docs", "what am I looking at", and "summarize this".',
  'Preserve short navigation phrases such as "go to", "open", "visit", "navigate to", or "take me to".',
  'If the audio is unclear or you are not confident, return an empty string.',
  'Do not explain, do not answer the command, and do not include labels.',
  'Output only the recovered spoken command.',
].join(' ');

const COMMAND_CLASSIFIER_PROMPT = [
  'Classify this audio for Sally, a desktop accessibility assistant.',
  'Return JSON only with this exact shape: {"intent":"describe_screen|summarize_screen|screen_question|browse_command|smart_home|cancel|none","canonicalCommand":"string","confidence":"high|low"}.',
  'Use intent "none" and an empty canonicalCommand unless the audio clearly supports a command.',
  'For describe_screen, use canonicalCommand "what am i looking at".',
  'For summarize_screen, use canonicalCommand "summarize this".',
  'For screen_question, keep the user question as the canonicalCommand.',
  'Use screen_question for visual questions like "who is this", "how many people are here", "what names can you see", or "find more info about them".',
  'For cancel, use canonicalCommand "cancel".',
  'Use browse_command only for clear browser commands such as open, go to, search for, click, press, scroll, navigate, fill, or select.',
  'Use smart_home only for clear device commands such as lights on, turn off the fan, or set the thermostat.',
  'If the audio is partial, weak, noisy, uncertain, or sounds like random speech, return intent "none" with low confidence.',
  'Do not invent words that are not clearly supported by the audio.',
].join(' ');

const PROMPT_ECHO_PATTERNS = [
  'transcribe exactly the words actually spoken',
  'transcribe this audio recording into text',
  'output only the spoken words',
  'do not guess',
  'do not repeat these instructions',
];

const UNCLEAR_TRANSCRIPT_PATTERNS = [
  /^(?:i am|i'm|im)\b(?! looking\b)/i,
  /^not sure\b/i,
  /^i do(?:n't| not) know\b/i,
  /^(?:um|uh|hmm|hm)\b/i,
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
  /^find$/i,
  /^click$/i,
  /^go$/i,
  /^go to$/i,
  /^navigate$/i,
  /^navigate to$/i,
  /^visit$/i,
  /^take me$/i,
  /^take me to$/i,
  /^bring me$/i,
  /^bring me to$/i,
  /^look up$/i,
  /^lookup$/i,
  /^research$/i,
  /^fill$/i,
  /^select$/i,
  /^press$/i,
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

const SMART_HOME_PATTERNS = [
  /\blights?\s+(?:on|off)\b/i,
  /\b(?:turn|switch)\s+(?:on|off)\s+(?:the\s+)?(?:.+?\s+)?(?:lights?|fan)\b/i,
  /\b(?:set|change)\s+(?:the\s+)?(?:thermostat|temperature|temp)\s+(?:to\s+)?\d+\b/i,
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

const BROWSE_COMMAND_STARTERS = [
  'open',
  'go',
  'search',
  'find',
  'click',
  'press',
  'scroll',
  'navigate',
  'fill',
  'select',
  'show',
];

const STRONG_BROWSE_COMMAND_PATTERNS = [
  /^(?:open|go to|navigate to|visit|take me to|bring me to)\s+\S+/i,
  /^(?:search(?: for)?|find|look up|lookup|research)\s+\S+/i,
];

const CLIPPED_BROWSE_FALSE_POSITIVE_PATTERNS = [
  /^what(?:'s| is) the$/i,
  /^what(?:'s| is)$/i,
  /^what am$/i,
  /^what am i$/i,
  /^go$/i,
];

export type TranscriptionIntent =
  | 'describe_screen'
  | 'summarize_screen'
  | 'screen_question'
  | 'browse_command'
  | 'smart_home'
  | 'cancel'
  | 'none';

export type TranscriptionConfidence = 'high' | 'low';
export type TranscriptionSource = 'gemini' | 'recovery';

export interface TranscriptionResult {
  transcript: string;
  canonicalCommand: string;
  intent: TranscriptionIntent;
  confidence: TranscriptionConfidence;
  source: TranscriptionSource;
}

interface RecoveryIntentResponse {
  intent?: string;
  canonicalCommand?: string;
  confidence?: string;
}

class TranscriptionService {
  async transcribe(
    audioBase64: string,
    mimeType: string,
    options: { durationMs?: number; isPreview?: boolean } = {},
  ): Promise<TranscriptionResult> {
    const geminiKey = apiKeyManager.getGeminiApiKey();
    if (!geminiKey) {
      throw new Error('No transcription API key configured. Set a Gemini key in settings.');
    }

    const transcript = await this.transcribeWithGemini(audioBase64, mimeType, geminiKey, options);
    const source: TranscriptionSource = 'gemini';

    const firstPass = this.buildTranscriptionResult(transcript, source);

    if (geminiKey && this.shouldRetryWithCommandRecovery(firstPass, options)) {
      try {
        const recoveredTranscript = await this.transcribeWithGemini(
          audioBase64,
          mimeType,
          geminiKey,
          options,
          COMMAND_RECOVERY_PROMPT,
        );
        const recoveredResult = this.buildTranscriptionResult(recoveredTranscript, 'recovery');
        if (this.shouldAcceptRecoveredTranscript(recoveredResult, firstPass)) {
          mainLogger.info('[Transcription] Recovered likely command from focused retry:', recoveredResult.canonicalCommand, recoveredResult.intent);
          return recoveredResult;
        }
      } catch (error) {
        mainLogger.warn('[Transcription] Focused command recovery failed:', error);
      }

      try {
        const recovered = await this.classifyIntentWithGemini(audioBase64, mimeType, geminiKey, options);
        if (this.shouldAcceptRecoveredIntent(recovered, firstPass)) {
          mainLogger.info('[Transcription] Recovered likely command:', recovered.canonicalCommand, recovered.intent);
          return recovered;
        }
      } catch (error) {
        mainLogger.warn('[Transcription] Command recovery failed:', error);
      }
    }

    return firstPass;
  }

  private sanitizeTranscript(rawText: string, options: { durationMs?: number; isPreview?: boolean }): string {
    const text = rawText.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!text) {
      return '';
    }

    const normalized = text.toLowerCase();
    if (PROMPT_ECHO_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return '';
    }

    const durationMs = Math.max(options.durationMs ?? 0, 0);
    if (options.isPreview && durationMs < 1400) {
      return '';
    }

    if (durationMs > 0) {
      const words = text.split(/\s+/).filter(Boolean);
      const maxReasonableWords = Math.max(
        options.isPreview ? 4 : 5,
        Math.ceil(durationMs / (options.isPreview ? 190 : 160)) + 1,
      );

      if (words.length > maxReasonableWords) {
        mainLogger.warn('[Transcription] Discarding implausible transcript for clip length:', { durationMs, words: words.length, text });
        return '';
      }
    }

    return text;
  }

  private looksCommandLike(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    if (INCOMPLETE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (
      /\bsummari[sz]e (?:this|that|(?:the |this )?(?:screen|page))\b/i.test(normalized)
      || /\bsummari[sz]e what (?:i am|i'm) seeing\b/i.test(normalized)
      || /\bsummari[sz]e what(?:'s| is) on (?:my |the )?(?:screen|page)\b/i.test(normalized)
      || /\bsum (?:this|that) up\b/i.test(normalized)
      || /\bwhat am i looking at\b/i.test(normalized)
      || /\bwhat(?:'s| is) on (?:my |the )?(?:screen|page)\b/i.test(normalized)
      || /\bdescribe (?:the |this )?(?:screen|page)\b/i.test(normalized)
      || /\bread (?:the |this )?(?:screen|page)\b/i.test(normalized)
    ) {
      return true;
    }

    if (this.looksLikeScreenQuestion(normalized)) {
      return true;
    }

    if (this.looksLikeBrowseCommand(normalized)) {
      return true;
    }

    return /\b(screen|page|browser|google|chrome|tab|button|link|lights?|fan|thermostat|temperature|code|error|site|website)\b/i.test(normalized);
  }

  private looksLikeBrowseCommand(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    if (INCOMPLETE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (UNCLEAR_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (/^find (?:more info|more information|out more|out more about)\b/i.test(normalized)) {
      return false;
    }

    return BROWSE_COMMAND_STARTERS.some((starter) =>
      normalized === starter || normalized.startsWith(`${starter} `)
    );
  }

  private looksLikeScreenQuestion(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    if (SUMMARIZE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized)) || DESCRIBE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (INCOMPLETE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (this.looksLikeBrowseCommand(normalized) || SMART_HOME_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    return SCREEN_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))
      || (SCREEN_QUESTION_STARTER_PATTERN.test(normalized) && SCREEN_QUESTION_CONTEXT_PATTERN.test(normalized));
  }

  private buildTranscriptionResult(text: string, source: TranscriptionSource): TranscriptionResult {
    const transcript = text.trim();
    const normalized = transcript.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();

    if (!transcript) {
      return {
        transcript: '',
        canonicalCommand: '',
        intent: 'none',
        confidence: 'low',
        source,
      };
    }

    if (normalized.includes('cancel') || normalized === 'stop') {
      return {
        transcript,
        canonicalCommand: 'cancel',
        intent: 'cancel',
        confidence: 'high',
        source,
      };
    }

    if (SUMMARIZE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        transcript,
        canonicalCommand: 'summarize this',
        intent: 'summarize_screen',
        confidence: 'high',
        source,
      };
    }

    if (DESCRIBE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        transcript,
        canonicalCommand: 'what am i looking at',
        intent: 'describe_screen',
        confidence: 'high',
        source,
      };
    }

    if (this.looksLikeScreenQuestion(normalized)) {
      return {
        transcript,
        canonicalCommand: transcript,
        intent: 'screen_question',
        confidence: 'high',
        source,
      };
    }

    if (INCOMPLETE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        transcript,
        canonicalCommand: '',
        intent: 'none',
        confidence: 'low',
        source,
      };
    }

    if (UNCLEAR_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        transcript,
        canonicalCommand: '',
        intent: 'none',
        confidence: 'low',
        source,
      };
    }

    if (SMART_HOME_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        transcript,
        canonicalCommand: transcript,
        intent: 'smart_home',
        confidence: 'high',
        source,
      };
    }

    if (this.looksLikeBrowseCommand(normalized)) {
      return {
        transcript,
        canonicalCommand: transcript,
        intent: 'browse_command',
        confidence: 'high',
        source,
      };
    }

    return {
      transcript,
      canonicalCommand: '',
      intent: 'none',
      confidence: 'low',
      source,
    };
  }

  private shouldRetryWithCommandRecovery(
    result: TranscriptionResult,
    options: { durationMs?: number; isPreview?: boolean },
  ): boolean {
    if (options.isPreview) {
      return false;
    }

    const durationMs = Math.max(options.durationMs ?? 0, 0);
    if (!result.transcript) {
      return durationMs >= 1000;
    }

    return result.confidence === 'low';
  }

  private shouldAcceptRecoveredIntent(
    recovered: TranscriptionResult,
    firstPass: TranscriptionResult,
  ): boolean {
    if (recovered.confidence !== 'high' || recovered.intent === 'none' || !recovered.canonicalCommand) {
      return false;
    }

    if (
      recovered.intent === 'describe_screen'
      || recovered.intent === 'summarize_screen'
      || recovered.intent === 'cancel'
    ) {
      return true;
    }

    const firstPassNormalized = firstPass.transcript.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!firstPassNormalized) {
      return false;
    }

    if (recovered.intent === 'smart_home') {
      return SMART_HOME_PATTERNS.some((pattern) => pattern.test(firstPassNormalized));
    }

    if (recovered.intent === 'browse_command') {
      return this.looksLikeBrowseCommand(firstPassNormalized)
        || (
          firstPass.confidence === 'low'
          && CLIPPED_BROWSE_FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(firstPassNormalized))
          && this.hasStrongBrowseCommandShape(recovered.canonicalCommand)
        );
    }

    if (recovered.intent === 'screen_question') {
      return this.looksLikeScreenQuestion(firstPassNormalized);
    }

    return false;
  }

  private shouldAcceptRecoveredTranscript(
    recovered: TranscriptionResult,
    firstPass: TranscriptionResult,
  ): boolean {
    if (recovered.confidence !== 'high' || !recovered.canonicalCommand) {
      return false;
    }

    if (recovered.intent === 'browse_command') {
      return this.hasStrongBrowseCommandShape(recovered.canonicalCommand)
        || firstPass.confidence === 'low';
    }

    if (recovered.intent === 'screen_question' || recovered.intent === 'smart_home') {
      return firstPass.confidence === 'low';
    }

    return recovered.intent === 'describe_screen'
      || recovered.intent === 'summarize_screen'
      || recovered.intent === 'cancel';
  }

  private hasStrongBrowseCommandShape(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    return STRONG_BROWSE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  private async transcribeWithGemini(
    audioBase64: string,
    mimeType: string,
    apiKey: string,
    options: { durationMs?: number; isPreview?: boolean },
    promptText = TRANSCRIPTION_PROMPT,
  ): Promise<string> {
    const geminiMime = mimeType.includes('webm') ? 'audio/webm'
      : mimeType.includes('mp4') ? 'audio/mp4'
      : mimeType.includes('wav') ? 'audio/wav'
      : mimeType;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: geminiMime,
                  data: audioBase64,
                },
              },
              {
                text: promptText,
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 96,
            temperature: 0,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini transcription error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = this.sanitizeTranscript(
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '',
      options,
    );
    mainLogger.info('[Transcription] Gemini result:', text);
    return text;
  }

  private async classifyIntentWithGemini(
    audioBase64: string,
    mimeType: string,
    apiKey: string,
    options: { durationMs?: number; isPreview?: boolean },
  ): Promise<TranscriptionResult> {
    const geminiMime = mimeType.includes('webm') ? 'audio/webm'
      : mimeType.includes('mp4') ? 'audio/mp4'
      : mimeType.includes('wav') ? 'audio/wav'
      : mimeType;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: geminiMime,
                  data: audioBase64,
                },
              },
              {
                text: COMMAND_CLASSIFIER_PROMPT,
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 96,
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini command classifier error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const parsed = this.parseRecoveryIntentResponse(raw);
    return this.normalizeRecoveryIntent(parsed, options);
  }

  private parseRecoveryIntentResponse(raw: string): RecoveryIntentResponse {
    if (!raw.trim()) {
      return {};
    }

    try {
      return JSON.parse(raw) as RecoveryIntentResponse;
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        return {};
      }

      try {
        return JSON.parse(match[0]) as RecoveryIntentResponse;
      } catch {
        return {};
      }
    }
  }

  private normalizeRecoveryIntent(
    response: RecoveryIntentResponse,
    options: { durationMs?: number; isPreview?: boolean },
  ): TranscriptionResult {
    const intent = response.intent;
    const confidence = response.confidence === 'high' ? 'high' : 'low';
    const transcript = this.sanitizeTranscript(response.canonicalCommand || '', options);

    if (
      intent !== 'describe_screen'
      && intent !== 'summarize_screen'
      && intent !== 'screen_question'
      && intent !== 'browse_command'
      && intent !== 'smart_home'
      && intent !== 'cancel'
      && intent !== 'none'
    ) {
      return {
        transcript,
        canonicalCommand: '',
        intent: 'none',
        confidence: 'low',
        source: 'recovery',
      };
    }

    if (intent === 'describe_screen') {
      return {
        transcript,
        canonicalCommand: 'what am i looking at',
        intent,
        confidence,
        source: 'recovery',
      };
    }

    if (intent === 'summarize_screen') {
      return {
        transcript,
        canonicalCommand: 'summarize this',
        intent,
        confidence,
        source: 'recovery',
      };
    }

    if (intent === 'cancel') {
      return {
        transcript,
        canonicalCommand: 'cancel',
        intent,
        confidence,
        source: 'recovery',
      };
    }

    if (intent === 'screen_question' && confidence === 'high' && this.looksLikeScreenQuestion(transcript)) {
      return {
        transcript,
        canonicalCommand: transcript,
        intent,
        confidence,
        source: 'recovery',
      };
    }

    if ((intent === 'browse_command' || intent === 'smart_home') && confidence === 'high' && this.looksCommandLike(transcript)) {
      return {
        transcript,
        canonicalCommand: transcript,
        intent,
        confidence,
        source: 'recovery',
      };
    }

    return {
      transcript,
      canonicalCommand: '',
      intent: 'none',
      confidence: 'low',
      source: 'recovery',
    };
  }
}

export const transcriptionService = new TranscriptionService();
