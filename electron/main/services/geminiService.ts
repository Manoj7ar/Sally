// Gemini Vision Service - optional backend with direct Gemini fallback
import { GoogleGenAI } from '@google/genai';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';
import type { BrowserSourceMode, PageContext } from './pageContext.js';

export interface GeminiAction {
  type: string;
  selector?: string;
  value?: string;
  url?: string;
  index?: number;
}

export interface GeminiInterpretResult {
  narration: string;
  action: GeminiAction | null;
}

export interface GeminiScreenQuestionResult {
  answer: string;
  shouldResearch: boolean;
  researchQuery: string | null;
}

interface InterpretParams {
  screenshot: string;
  instruction: string;
  history?: string[];
  pageUrl?: string;
  pageTitle?: string;
  pageContext?: PageContext;
  sourceMode?: BrowserSourceMode;
}

interface ScreenQuestionParams {
  screenshot: string;
  question: string;
  pageUrl?: string;
  pageTitle?: string;
  autoResearchEnabled?: boolean;
  pageContext?: PageContext;
  sourceMode?: BrowserSourceMode;
}

const BACKEND_COOLDOWN_MS = 5 * 60 * 1000;
const BACKEND_TIMEOUT_MS = 8000;
const VALID_ACTION_TYPES = new Set([
  'navigate', 'click', 'fill', 'type', 'select', 'press',
  'hover', 'focus', 'check', 'uncheck', 'scroll', 'scroll_up', 'back', 'wait', 'null',
]);

const AGENT_SYSTEM_PROMPT = `You are Sally, a warm and confident AI assistant who helps people navigate and control the web using their voice.

You work in an agentic loop: you receive a browser screenshot, the current URL and page title when available, optional structured page context, and a user instruction. Return one next step at a time.

Your job:
1. Briefly describe what you see that matters for the user's goal.
2. Decide the single best next action.
3. If the goal is complete or no action is needed, set action to null.

Grounding rules:
- Base your narration on what is actually visible.
- Use the page URL, title, and structured page context to verify where you are.
- Treat the screenshot as the primary truth and the page context as a grounding aid.
- If unsure, say so instead of guessing.

Action rules:
- Return exactly one action per response.
- Use visible text, labels, placeholders, roles, and ordinal position for selectors.
- Prefer structured controls from pageContext when available.
- Keep narration short and natural because it will be spoken aloud.
- If the task is purely descriptive, set action to null.`;

const SCREEN_QUESTION_SYSTEM_PROMPT = `You are Sally, a multimodal accessibility assistant answering questions about what is visible on screen.

Your job:
1. Read the user's exact question.
2. Answer using the screenshot first.
3. Only use outside knowledge if the user explicitly asks for more information and auto-research is allowed.

Rules:
- Keep the answer concise and natural because it will be spoken aloud.
- If something is not clearly visible, say that honestly.
- Use page context as a grounding aid when it matches the screenshot.
- For counting, count conservatively and say "at least" when visibility is partial.
- Do not guess a person's identity if the screenshot alone is not enough.
- If auto-research is disabled, always return shouldResearch=false.
- If auto-research is enabled, only return shouldResearch=true when the user clearly wants more information beyond what is visible and you can form a safe, specific search query from visible names, labels, or text.`;

class GeminiService {
  private backendCooldownUntil = 0;
  private directClient: GoogleGenAI | null = null;
  private directClientKey: string | null = null;

  async interpretScreen(params: InterpretParams): Promise<GeminiInterpretResult> {
    return this.withBackendFallback(
      (backendUrl) => this.interpretWithBackend(backendUrl, params),
      () => this.interpretDirect(params),
    );
  }

  async answerScreenQuestion(params: ScreenQuestionParams): Promise<GeminiScreenQuestionResult> {
    return this.withBackendFallback(
      (backendUrl) => this.answerScreenQuestionWithBackend(backendUrl, params),
      () => this.answerScreenQuestionDirect(params),
    );
  }

  private async withBackendFallback<T>(
    backendCall: (backendUrl: string) => Promise<T>,
    directCall: () => Promise<T>,
  ): Promise<T> {
    const backendUrl = apiKeyManager.getGeminiBackendUrl();
    let backendError: Error | null = null;

    if (backendUrl && Date.now() >= this.backendCooldownUntil) {
      try {
        return await backendCall(backendUrl);
      } catch (error) {
        backendError = error instanceof Error ? error : new Error(String(error));
        this.backendCooldownUntil = Date.now() + BACKEND_COOLDOWN_MS;
        console.warn('[GeminiService] Backend failed, falling back to direct Gemini:', backendError.message);
      }
    }

    if (apiKeyManager.hasGeminiApiKey()) {
      return directCall();
    }

    if (backendError) {
      throw backendError;
    }

    throw new Error('Gemini vision is not configured. Add a Gemini API key or a working backend URL.');
  }

  private async interpretWithBackend(backendUrl: string, params: InterpretParams): Promise<GeminiInterpretResult> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/interpret-screen', params);
    return this.normalizeInterpretResult(raw);
  }

  private async answerScreenQuestionWithBackend(
    backendUrl: string,
    params: ScreenQuestionParams,
  ): Promise<GeminiScreenQuestionResult> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/answer-screen-question', params);
    return this.normalizeScreenQuestionResult(raw);
  }

  private async postToBackend<T>(backendUrl: string, route: string, body: object): Promise<T> {
    const url = `${backendUrl.replace(/\/$/, '')}${route}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini backend error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private getDirectClient(): GoogleGenAI {
    const apiKey = apiKeyManager.getGeminiApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is not configured.');
    }

    if (!this.directClient || this.directClientKey !== apiKey) {
      this.directClient = new GoogleGenAI({ apiKey });
      this.directClientKey = apiKey;
    }

    return this.directClient;
  }

  private getGroundingBlock(pageUrl?: string, pageTitle?: string): string {
    if (!pageUrl) {
      return '';
    }

    return `\n\nCurrent page:\n- URL: ${pageUrl}\n- Title: ${pageTitle || '(untitled)'}`;
  }

  private getPageContextBlock(pageContext?: PageContext): string {
    if (!pageContext) {
      return '';
    }

    const controls = pageContext.interactiveElements
      .slice(0, 12)
      .map((element) => {
        const descriptor = [element.label, element.text, element.placeholder].filter(Boolean)[0] || element.tagName;
        const state: string[] = [];
        if (element.disabled) state.push('disabled');
        if (element.checked) state.push('checked');
        if (element.selected) state.push('selected');
        const suffix = state.length > 0 ? ` (${state.join(', ')})` : '';
        return `${element.index}. ${element.role} "${descriptor}"${suffix}`;
      })
      .join('\n');

    const blocks = [
      pageContext.semanticSummary ? `Semantic summary:\n${pageContext.semanticSummary}` : '',
      controls ? `Visible interactive elements:\n${controls}` : '',
      pageContext.headings.length > 0 ? `Headings:\n${pageContext.headings.join('\n')}` : '',
      pageContext.visibleMessages.length > 0 ? `Visible messages:\n${pageContext.visibleMessages.join('\n')}` : '',
      pageContext.dialogs.length > 0 ? `Dialogs:\n${pageContext.dialogs.join('\n')}` : '',
      pageContext.activeElement ? `Focused element:\n${pageContext.activeElement}` : '',
    ].filter(Boolean);

    return blocks.length > 0 ? `\n\nStructured page context:\n${blocks.join('\n\n')}` : '';
  }

  private getSourceModeBlock(sourceMode?: BrowserSourceMode): string {
    if (!sourceMode) {
      return '';
    }

    return '\n\nBrowser source mode:\n- electron_browser (Sally-owned Electron browser with live DOM access)';
  }

  private async interpretDirect(params: InterpretParams): Promise<GeminiInterpretResult> {
    const groundingBlock = this.getGroundingBlock(params.pageUrl, params.pageTitle);
    const pageContextBlock = this.getPageContextBlock(params.pageContext);
    const sourceModeBlock = this.getSourceModeBlock(params.sourceMode);
    const historyBlock = params.history && params.history.length > 0
      ? `\n\nSteps already completed:\n${params.history.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\nDo not repeat these steps. If any step is marked FAILED, try a different selector or approach.`
      : '';

    const userPrompt = `User instruction: "${params.instruction}"${groundingBlock}${sourceModeBlock}${pageContextBlock}${historyBlock}

Analyze the screenshot and respond with valid JSON only:
{
  "narration": "1-2 spoken sentences describing what matters for the user's goal",
  "action": {
    "type": "navigate|click|fill|type|select|press|hover|focus|check|uncheck|scroll|scroll_up|back|wait",
    "selector": "visible text, aria-label, placeholder, or CSS selector",
    "index": 1,
    "value": "text to type, selected option, pressed key, or wait duration",
    "url": "URL to navigate to"
  }
}

If no action is needed, set action to null.
Use "index" only when there are multiple similar visible matches and ordinal targeting helps.`;

    const raw = await this.generateJson({
      systemInstruction: AGENT_SYSTEM_PROMPT,
      prompt: userPrompt,
      screenshot: params.screenshot,
      maxOutputTokens: 512,
      temperature: 0.2,
      fallback: { narration: 'I can see the screen.', action: null },
    });

    return this.normalizeInterpretResult(raw);
  }

  private async answerScreenQuestionDirect(params: ScreenQuestionParams): Promise<GeminiScreenQuestionResult> {
    const groundingBlock = this.getGroundingBlock(params.pageUrl, params.pageTitle);
    const pageContextBlock = this.getPageContextBlock(params.pageContext);
    const sourceModeBlock = this.getSourceModeBlock(params.sourceMode);
    const researchRules = params.autoResearchEnabled
      ? 'Auto-research is enabled. Set shouldResearch=true only when the user clearly wants extra information beyond what is visible and you can form a safe, specific search query from visible names or text.'
      : 'Auto-research is disabled. Always return shouldResearch=false and researchQuery=null.';

    const prompt = `User question about the screenshot: "${params.question}"${groundingBlock}${sourceModeBlock}${pageContextBlock}

${researchRules}

Respond with valid JSON only:
{
  "answer": "short spoken answer to the user's question",
  "shouldResearch": true,
  "researchQuery": "specific web search query or null"
}`;

    const raw = await this.generateJson({
      systemInstruction: SCREEN_QUESTION_SYSTEM_PROMPT,
      prompt,
      screenshot: params.screenshot,
      maxOutputTokens: 384,
      temperature: 0.1,
      fallback: {
        answer: "I can see the screen, but I couldn't answer that clearly from the image.",
        shouldResearch: false,
        researchQuery: null,
      },
    });

    return this.normalizeScreenQuestionResult(raw);
  }

  private async generateJson(params: {
    systemInstruction: string;
    prompt: string;
    screenshot: string;
    maxOutputTokens: number;
    temperature: number;
    fallback: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const genai = this.getDirectClient();

    const result = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: params.screenshot,
              },
            },
            { text: params.prompt },
          ],
        },
      ],
      config: {
        systemInstruction: params.systemInstruction,
        responseMimeType: 'application/json',
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature,
      },
    });

    return this.parseJsonResponse(result.text || '', params.fallback);
  }

  private parseJsonResponse(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      try {
        return JSON.parse(stripped) as Record<string, unknown>;
      } catch {
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          } catch {
            return fallback;
          }
        }
        return fallback;
      }
    }
  }

  private normalizeInterpretResult(raw: Record<string, unknown>): GeminiInterpretResult {
    const narration = typeof raw.narration === 'string' && raw.narration
      ? raw.narration
      : 'I can see the screen.';

    let action: GeminiAction | null = null;
    if (raw.action && typeof raw.action === 'object' && !Array.isArray(raw.action)) {
      const candidate = raw.action as Record<string, unknown>;
      if (typeof candidate.type === 'string' && VALID_ACTION_TYPES.has(candidate.type)) {
        action = { type: candidate.type };
      if (typeof candidate.selector === 'string') action.selector = candidate.selector;
      if (typeof candidate.index === 'number' && Number.isFinite(candidate.index) && candidate.index > 0) {
        action.index = Math.floor(candidate.index);
      }
      if (typeof candidate.value === 'string') action.value = candidate.value;
      if (typeof candidate.url === 'string') action.url = candidate.url;
    }
    }

    return { narration, action };
  }

  private normalizeScreenQuestionResult(raw: Record<string, unknown>): GeminiScreenQuestionResult {
    const answer = typeof raw.answer === 'string' && raw.answer.trim()
      ? raw.answer.trim()
      : "I can see the screen, but I couldn't answer that clearly from the image.";

    const researchQuery = typeof raw.researchQuery === 'string' && raw.researchQuery.trim()
      ? raw.researchQuery.trim()
      : null;

    return {
      answer,
      shouldResearch: Boolean(raw.shouldResearch) && Boolean(researchQuery),
      researchQuery,
    };
  }
}

export const geminiService = new GeminiService();
