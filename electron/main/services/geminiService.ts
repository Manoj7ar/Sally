// Gemini Vision Service - optional backend with direct Gemini fallback
import { GoogleGenAI } from '@google/genai';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';
import { mainLogger } from '../utils/logger.js';
import { cloudLog } from './cloudLogger.js';
import {
  normalizeBrowserRescueAnalysis as normalizeBrowserRescueAnalysisValue,
  normalizeEmailDraft as normalizeEmailDraftValue,
  normalizeInterpretResult as normalizeInterpretResultValue,
  normalizeScreenQuestionResult as normalizeScreenQuestionResultValue,
  normalizeTaskPlan as normalizeTaskPlanValue,
  normalizeUserRequestInterpretation as normalizeUserRequestInterpretationValue,
} from './geminiNormalizers.js';
import type { BrowserSourceMode, BrowserTabInfo, PageContext } from './pageContext.js';
import type { BrowserActionRequest, BrowserActionType } from '../../../shared/types.js';

export type GeminiActionType = BrowserActionType;
export type GeminiAction = BrowserActionRequest;

export interface GeminiInterpretResult {
  narration: string;
  action: GeminiAction | null;
}

export interface GeminiScreenQuestionResult {
  answer: string;
  shouldResearch: boolean;
  researchQuery: string | null;
}

export interface GeminiBrowserRescueSuggestion {
  label: string;
  reason: string;
  action: GeminiAction | null;
  safeToAutoExecute: boolean;
}

export interface GeminiBrowserRescueBlocker {
  label: string;
  reason: string;
}

export interface GeminiBrowserRescueAnalysis {
  pageSummary: string;
  blockers: GeminiBrowserRescueBlocker[];
  suggestions: GeminiBrowserRescueSuggestion[];
}

export type GeminiBrowserAssistiveIntent = 'actions' | 'buttons' | 'fields' | 'errors' | 'links' | 'headings';
export type GeminiUserRequestIntent =
  | 'browser_task'
  | 'browser_assistive'
  | 'browser_rescue'
  | 'describe_screen'
  | 'summarize_screen'
  | 'screen_question'
  | 'smart_home'
  | 'chat'
  | 'cancel'
  | 'clarify'
  | 'none';

export type GeminiUserRequestConfidence = 'high' | 'medium' | 'low';

export interface RecentUserTurn {
  user: string;
  assistant?: string;
  intent?: GeminiUserRequestIntent;
  normalizedInstruction?: string | null;
  browserAssistiveIntent?: GeminiBrowserAssistiveIntent | null;
}

export interface GeminiUserRequestInterpretation {
  intent: GeminiUserRequestIntent;
  confidence: GeminiUserRequestConfidence;
  normalizedInstruction: string | null;
  spokenResponse: string | null;
  clarificationQuestion: string | null;
  browserAssistiveIntent: GeminiBrowserAssistiveIntent | null;
}

export interface GeminiTaskSubtask {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'done' | 'blocked';
}

export interface GeminiTaskPlan {
  status: 'continue' | 'complete' | 'blocked' | 'clarify';
  planSummary: string;
  activeSubtask: string | null;
  subtasks: GeminiTaskSubtask[];
  rememberedFacts: string[];
  clarificationQuestion: string | null;
  completionNarration: string | null;
  blockedReason: string | null;
}

export interface GeminiEmailDraft {
  subject: string;
  body: string;
}

interface InterpretParams {
  screenshot: string;
  instruction: string;
  history?: string[];
  pageUrl?: string;
  pageTitle?: string;
  pageContext?: PageContext;
  sourceMode?: BrowserSourceMode;
  tabs?: BrowserTabInfo[];
  activeTabId?: string | null;
  overallGoal?: string;
  planSummary?: string;
  activeSubtask?: string | null;
  workingMemory?: string[];
  failureContext?: string | null;
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

interface BrowserRescueParams {
  screenshot: string;
  instruction?: string | null;
  pageUrl?: string;
  pageTitle?: string;
  pageContext?: PageContext;
  sourceMode?: BrowserSourceMode;
  tabs?: BrowserTabInfo[];
  activeTabId?: string | null;
  overallGoal?: string | null;
  failureContext?: string | null;
  history?: string[];
}

interface InterpretUserRequestParams {
  transcript: string;
  source: 'voice' | 'typed';
  browserIsOpen?: boolean;
  pageUrl?: string;
  pageTitle?: string;
  recentTurns?: RecentUserTurn[];
  pendingClarificationQuestion?: string | null;
}

interface PlanComplexTaskParams {
  goal: string;
  currentPlanSummary?: string | null;
  activeSubtask?: string | null;
  subtasks?: GeminiTaskSubtask[];
  history?: string[];
  workingMemory?: string[];
  failureCount?: number;
  lastFailure?: string | null;
  pageUrl?: string;
  pageTitle?: string;
  pageContext?: PageContext;
  sourceMode?: BrowserSourceMode;
  tabs?: BrowserTabInfo[];
  activeTabId?: string | null;
  triggerReason?: string | null;
}

interface GenerateEmailDraftParams {
  goal: string;
  recipientEmail: string;
  brief: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

const BACKEND_COOLDOWN_MS = 5 * 60 * 1000;
const BACKEND_TIMEOUT_MS = 8000;

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
- Prefer targetId from pageContext when a visible control clearly matches.
- Use visible text, labels, placeholders, roles, and ordinal position for selectors.
- Include framePath or shadowPath only when they help disambiguate the target.
- Prefer structured controls from pageContext when available.
- For planned tasks, follow the current subtask instead of searching or executing the whole overall goal at once.
- If the current subtask names a specific site or page, navigate or switch tabs for that destination directly instead of searching the entire user goal text.
- After typing into a search field, do not repeat the same typing action. Press Enter, choose a result, or continue based on the updated page.
- Use open_tab when the task benefits from researching or comparing something in another tab.
- Use switch_tab when the target page is already open in another tab.
- Keep narration short and natural because it will be spoken aloud.
- If the task is purely descriptive, set action to null.`;

const COMPLEX_TASK_PLANNER_PROMPT = `You are Sally's browser task planner for longer website workflows.

Return valid JSON only with this exact shape:
{
  "status": "continue|complete|blocked|clarify",
  "planSummary": "short summary of the whole plan",
  "activeSubtask": "single short subtask Sally should work on next or null",
  "subtasks": [
    { "id": "s1", "title": "short subtask", "status": "pending|active|done|blocked" }
  ],
  "rememberedFacts": ["short fact", "another short fact"],
  "clarificationQuestion": "short question or null",
  "completionNarration": "short completion message or null",
  "blockedReason": "short blocker or null"
}

Planner rules:
- Break the goal into 2 to 5 short subtasks when useful.
- Keep the activeSubtask narrow enough for one short burst of browser actions.
- Use rememberedFacts for names, email addresses, dates, comparison facts, selected links, or other useful task state.
- Use the current tabs and page context to avoid redundant work.
- If the goal spans multiple sites, tabs, or phases, preserve them as separate subtasks instead of collapsing everything into one generic search.
- Reuse already-open tabs when possible before opening a new tab.
- If the user wants facts from one page used in an email or form on another page, gather the facts first, store them in rememberedFacts, then draft or fill using those facts.
- If the user asks for confirmation before sending or submitting, keep that as the final step and do not mark the task complete until Sally is paused for confirmation.
- If the user says "the company website" but does not identify which company, use status=clarify with a short question.
- If the goal is already complete, use status=complete.
- If the task needs the user to resolve ambiguity, use status=clarify with one short clarificationQuestion.
- If the task is blocked by site limitations or missing information, use status=blocked with blockedReason.
- Do not return long explanations.`; 

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

const EMAIL_DRAFT_SYSTEM_PROMPT = `You write complete plain-text emails for Sally.

Return valid JSON only with this exact shape:
{
  "subject": "short subject line",
  "body": "plain-text email body"
}

Rules:
- Expand the user's short brief into a complete email.
- Infer tone from the brief. Use a casual tone for informal topics like invitations, parties, and friendly updates. Use a professional tone for formal or work-related topics.
- Write a real email with a greeting, 2 or 3 short paragraphs when helpful, and a closing.
- Keep the email concise but complete.
- Do not use markdown, bullets, placeholders, or brackets unless the user explicitly asked for them.
- Preserve important facts from the brief such as dates, times, locations, and purpose.
- If the brief is sparse, make reasonable assumptions without inventing sensitive facts.`;

const BROWSER_RESCUE_SYSTEM_PROMPT = `You are Sally's browser rescue analyzer.

Your job is to help when the user says they are stuck on the current page.

Return valid JSON only with this exact shape:
{
  "pageSummary": "one short sentence about what this page is mainly for",
  "blockers": [
    { "label": "short blocker label", "reason": "short explanation of what is blocking progress" }
  ],
  "suggestions": [
    {
      "label": "short next step",
      "reason": "why this helps",
      "action": {
        "type": "click|fill|focus|select|press|hover|check|uncheck|null",
        "targetId": "stable target id from pageContext when available",
        "selector": "visible label, text, placeholder, or CSS selector",
        "index": 1,
        "framePath": [1],
        "shadowPath": [1],
        "value": "optional value for fill/select/press"
      },
      "safeToAutoExecute": false
    }
  ]
}

Rules:
- Explain the main page purpose briefly.
- Identify blockers like dialogs, missing fields, disabled controls, visible errors, or confusing states.
- Suggest 2 to 3 short next steps grounded in the visible page state.
- Prefer safe, reversible next steps.
- Mark safeToAutoExecute=true only for clearly low-risk actions on obvious visible controls.
- Never mark risky actions like send, submit, delete, purchase, publish, sign out, authentication, or permissions as safeToAutoExecute.
- Do not try to summarize the whole screen. Focus only on the main point, the main blocker, and the best next step.
- Keep labels, reasons, and actions short because Sally may speak them aloud.
- Keep each field compact enough that Sally can read the final rescue response in at most three short lines.
- Do not include markdown or prose outside the JSON object.`;

const USER_REQUEST_INTERPRETER_PROMPT = `You are Sally's request interpreter. Your job is to infer what the human means in natural language, not to force them into exact command phrases.

Return valid JSON only with this exact shape:
{
  "intent": "browser_task|browser_assistive|browser_rescue|describe_screen|summarize_screen|screen_question|smart_home|chat|cancel|clarify|none",
  "confidence": "high|medium|low",
  "normalizedInstruction": "string or null",
  "spokenResponse": "short spoken answer or null",
  "clarificationQuestion": "one short follow-up question or null",
  "browserAssistiveIntent": "actions|buttons|fields|errors|links|headings|null"
}

Intent rules:
- Use browser_task when the user wants Sally to open, navigate, click, type, search, or do something in the browser.
- Use browser_assistive when the user is asking what they can do on the current page or wants visible buttons, links, fields, errors, or headings read out.
- Use browser_rescue when the user says they are stuck, needs help getting through the current page, or wants Sally to choose the next helpful step on the current page.
- Use describe_screen for requests to describe what is visible.
- Use summarize_screen for concise summaries of what is visible.
- Use screen_question for a specific question about what is visible or currently on the page or screen.
- Use smart_home for natural smart-home requests like lights, thermostat, fan, or turning devices on and off.
- Use chat for brief conversational replies, capability questions, or non-browser answers.
- Use cancel only for an explicit stop or cancel request.
- Use clarify when the request is ambiguous and you need one short follow-up question.
- Use none only for silence, noise, or text with no useful meaning.

Behavior rules:
- Understand paraphrases and intent, not exact trigger phrases.
- Screen-focused requests must still classify correctly even when no Sally browser is open.
- Do not turn a screen request into chat just because the browser is closed.
- Browser availability affects execution readiness, not intent classification.
- Long actionable requests that chain several browser steps, destinations, tabs, remembered facts, or email drafting are browser_task, not describe_screen or clarify.
- Requests that mention specific sites, tabs, remembered facts, and a final action like drafting an email should stay browser_task even if the current browser page is unrelated.
- Treat phrases like "I'm stuck", "help me here", "what should I do here", and "how do I get through this" as browser_rescue when they refer to the current page or browser.
- Treat phrases like "describe my screen", "what's going on here", "summarize what I'm seeing", "who is this person", and "what error am I looking at" as screen intents.
- Treat phrases like "what can I do on this page" or "what buttons are here" as browser_assistive, even if Sally later needs to tell the user to open a page first.
- Prefer normalizedInstruction that preserves the user's meaning in short plain language.
- Preserve important entities such as site names, company names, and email addresses in normalizedInstruction.
- If a browser task is obvious, do not ask a clarification question.
- If the user seems to be following up on a recent turn, use that context instead of defaulting to clarify.
- Referential follow-ups like "tell me more about that", "what about this", or "read more" should usually continue the most recent meaningful intent.
- Keep spokenResponse short because it may be read aloud.
- For browser_assistive, set browserAssistiveIntent when it is clear; otherwise use "actions".
- Do not answer with long explanations.`;

class GeminiService {
  private backendCooldownUntil = 0;
  private directClient: GoogleGenAI | null = null;
  private directClientKey: string | null = null;

  async interpretScreen(params: InterpretParams): Promise<GeminiInterpretResult> {
    return this.withBackendFallback(
      'interpret_screen',
      (backendUrl) => this.interpretWithBackend(backendUrl, params),
      () => this.interpretDirect(params),
    );
  }

  async answerScreenQuestion(params: ScreenQuestionParams): Promise<GeminiScreenQuestionResult> {
    return this.withBackendFallback(
      'answer_screen_question',
      (backendUrl) => this.answerScreenQuestionWithBackend(backendUrl, params),
      () => this.answerScreenQuestionDirect(params),
    );
  }

  async analyzeBrowserRescue(params: BrowserRescueParams): Promise<GeminiBrowserRescueAnalysis> {
    return this.withBackendFallback(
      'analyze_browser_rescue',
      (backendUrl) => this.analyzeBrowserRescueWithBackend(backendUrl, params),
      () => this.analyzeBrowserRescueDirect(params),
    );
  }

  async analyzeRescue(params: BrowserRescueParams): Promise<GeminiBrowserRescueAnalysis> {
    return this.analyzeBrowserRescue(params);
  }

  async interpretUserRequest(params: InterpretUserRequestParams): Promise<GeminiUserRequestInterpretation> {
    return this.withBackendFallback(
      'interpret_user_request',
      (backendUrl) => this.interpretUserRequestWithBackend(backendUrl, params),
      () => this.interpretUserRequestDirect(params),
    );
  }

  async planComplexTask(params: PlanComplexTaskParams): Promise<GeminiTaskPlan> {
    return this.withBackendFallback(
      'plan_complex_task',
      (backendUrl) => this.planComplexTaskWithBackend(backendUrl, params),
      () => this.planComplexTaskDirect(params),
    );
  }

  async generateEmailDraft(params: GenerateEmailDraftParams): Promise<GeminiEmailDraft> {
    return this.withBackendFallback(
      'generate_email_draft',
      (backendUrl) => this.generateEmailDraftWithBackend(backendUrl, params),
      () => this.generateEmailDraftDirect(params),
    );
  }

  private async withBackendFallback<T>(
    operation: string,
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
        mainLogger.warn('[GeminiService] Backend failed, falling back to direct Gemini:', backendError.message);
        cloudLog('WARNING', 'gemini_backend_fallback', {
          operation,
          backendUrl,
          backendCooldownUntil: this.backendCooldownUntil,
          error: this.serializeError(backendError),
        });
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

  private async analyzeBrowserRescueWithBackend(
    backendUrl: string,
    params: BrowserRescueParams,
  ): Promise<GeminiBrowserRescueAnalysis> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/analyze-browser-rescue', params);
    return this.normalizeBrowserRescueAnalysis(raw);
  }

  private async interpretUserRequestWithBackend(
    backendUrl: string,
    params: InterpretUserRequestParams,
  ): Promise<GeminiUserRequestInterpretation> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/interpret-user-request', params);
    return this.normalizeUserRequestInterpretation(raw, params.transcript);
  }

  private async planComplexTaskWithBackend(
    backendUrl: string,
    params: PlanComplexTaskParams,
  ): Promise<GeminiTaskPlan> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/plan-complex-task', params);
    return this.normalizeTaskPlan(raw, params.goal);
  }

  private async generateEmailDraftWithBackend(
    backendUrl: string,
    params: GenerateEmailDraftParams,
  ): Promise<GeminiEmailDraft> {
    const raw = await this.postToBackend<Record<string, unknown>>(backendUrl, '/api/generate-email-draft', params);
    return this.normalizeEmailDraft(raw, params.brief);
  }

  private async postToBackend<T>(backendUrl: string, route: string, body: object): Promise<T> {
    const url = `${backendUrl.replace(/\/$/, '')}${route}`;
    const startedAt = Date.now();

    try {
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

      cloudLog('INFO', 'gemini_api_call', {
        endpoint: 'backend',
        route,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: true,
      });

      return response.json() as Promise<T>;
    } catch (error) {
      cloudLog('ERROR', 'gemini_api_call', {
        endpoint: 'backend',
        route,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: this.serializeError(error),
      });
      throw error;
    }
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
      .slice(0, 16)
      .map((element) => {
        const descriptor = [element.label, element.text, element.placeholder].filter(Boolean)[0] || element.tagName;
        const state: string[] = [];
        if (element.disabled) state.push('disabled');
        if (element.checked) state.push('checked');
        if (element.selected) state.push('selected');
        if (typeof element.expanded === 'boolean') state.push(element.expanded ? 'expanded' : 'collapsed');
        if (typeof element.pressed === 'boolean') state.push(element.pressed ? 'pressed' : 'not pressed');
        const scope: string[] = [];
        if (element.framePath.length > 0) scope.push(`frame=${element.framePath.join('.')}`);
        if (element.shadowPath.length > 0) scope.push(`shadow=${element.shadowPath.join('.')}`);
        const suffix = state.length > 0 ? ` (${state.join(', ')})` : '';
        const scopeSuffix = scope.length > 0 ? ` [${scope.join(' ')}]` : '';
        return `${element.index}. ${element.role} "${descriptor}" [targetId=${element.targetId}]${scopeSuffix}${suffix}`;
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

  private getTabsBlock(tabs?: BrowserTabInfo[], activeTabId?: string | null): string {
    if (!tabs || tabs.length === 0) {
      return '';
    }

    const lines = tabs
      .slice(0, 8)
      .map((tab, index) => {
        const title = tab.title || '(untitled)';
        const url = tab.url || '(unknown)';
        const active = tab.id === activeTabId || tab.isActive ? 'ACTIVE ' : '';
        return `${index + 1}. ${active}[tabId=${tab.id}] ${title} - ${url}`;
      })
      .join('\n');

    return lines ? `\n\nOpen tabs:\n${lines}` : '';
  }

  private getSourceModeBlock(sourceMode?: BrowserSourceMode): string {
    if (!sourceMode) {
      return '';
    }

    return '\n\nBrowser source mode:\n- electron_browser (Sally-owned Electron browser with live DOM access)';
  }

  private getTaskExecutionBlock(params: InterpretParams): string {
    const blocks: string[] = [];

    if (params.overallGoal) {
      blocks.push(`Overall goal:\n${params.overallGoal}`);
    }

    if (params.planSummary) {
      blocks.push(`Current plan summary:\n${params.planSummary}`);
    }

    if (params.activeSubtask) {
      blocks.push(`Current subtask:\n${params.activeSubtask}`);
    }

    if (params.workingMemory && params.workingMemory.length > 0) {
      blocks.push(`Remembered task facts:\n${params.workingMemory.slice(0, 10).join('\n')}`);
    }

    if (params.failureContext) {
      blocks.push(`Recent failure context:\n${params.failureContext}`);
    }

    return blocks.length > 0 ? `\n\nTask execution context:\n${blocks.join('\n\n')}` : '';
  }

  private getPlannerStateBlock(params: PlanComplexTaskParams): string {
    const blocks: string[] = [];

    if (params.currentPlanSummary) {
      blocks.push(`Current plan summary:\n${params.currentPlanSummary}`);
    }

    if (params.activeSubtask) {
      blocks.push(`Current active subtask:\n${params.activeSubtask}`);
    }

    if (params.subtasks && params.subtasks.length > 0) {
      blocks.push(
        `Current subtasks:\n${params.subtasks
          .slice(0, 6)
          .map((subtask) => `- [${subtask.status}] ${subtask.id}: ${subtask.title}`)
          .join('\n')}`,
      );
    }

    if (params.workingMemory && params.workingMemory.length > 0) {
      blocks.push(`Remembered facts:\n${params.workingMemory.slice(0, 12).join('\n')}`);
    }

    if (params.history && params.history.length > 0) {
      blocks.push(`Recent action history:\n${params.history.slice(-12).join('\n')}`);
    }

    if (params.failureCount || params.lastFailure) {
      const parts = [`Consecutive failures: ${params.failureCount || 0}`];
      if (params.lastFailure) {
        parts.push(`Last failure: ${params.lastFailure}`);
      }
      blocks.push(parts.join('\n'));
    }

    if (params.triggerReason) {
      blocks.push(`Planner refresh reason:\n${params.triggerReason}`);
    }

    return blocks.length > 0 ? `\n\nPlanner state:\n${blocks.join('\n\n')}` : '';
  }

  private getRecentTurnsBlock(recentTurns?: RecentUserTurn[]): string {
    if (!recentTurns || recentTurns.length === 0) {
      return '';
    }

    const lines = recentTurns
      .slice(-3)
      .map((turn, index) => {
        const parts = [`${index + 1}. User: "${turn.user}"`];
        if (turn.intent) {
          parts.push(`intent=${turn.intent}`);
        }
        if (turn.normalizedInstruction) {
          parts.push(`normalized="${turn.normalizedInstruction}"`);
        }
        if (turn.browserAssistiveIntent) {
          parts.push(`assistive=${turn.browserAssistiveIntent}`);
        }
        if (turn.assistant) {
          parts.push(`assistant="${turn.assistant}"`);
        }
        return parts.join(' | ');
      })
      .join('\n');

    return lines ? `\n\nRecent interaction context:\n${lines}` : '';
  }

  private getClarificationBlock(question?: string | null): string {
    if (!question) {
      return '';
    }

    return `\n\nPending clarification:\nSally previously asked: "${question}"\nInterpret the new user message as their answer when reasonable.`;
  }

  private async interpretDirect(params: InterpretParams): Promise<GeminiInterpretResult> {
    const groundingBlock = this.getGroundingBlock(params.pageUrl, params.pageTitle);
    const pageContextBlock = this.getPageContextBlock(params.pageContext);
    const sourceModeBlock = this.getSourceModeBlock(params.sourceMode);
    const tabsBlock = this.getTabsBlock(params.tabs, params.activeTabId);
    const taskExecutionBlock = this.getTaskExecutionBlock(params);
    const historyBlock = params.history && params.history.length > 0
      ? `\n\nSteps already completed:\n${params.history.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\nDo not repeat these steps. If any step is marked FAILED, try a different selector or approach.`
      : '';

    const userPrompt = `User instruction: "${params.instruction}"${groundingBlock}${sourceModeBlock}${tabsBlock}${pageContextBlock}${taskExecutionBlock}${historyBlock}

Analyze the screenshot and respond with valid JSON only:
{
  "narration": "1-2 spoken sentences describing what matters for the user's goal",
  "action": {
    "type": "navigate|click|fill|type|select|press|hover|focus|check|uncheck|scroll|scroll_up|back|wait|open_tab|switch_tab",
    "targetId": "stable target id from pageContext when available",
    "selector": "visible text, aria-label, placeholder, or CSS selector",
    "index": 1,
    "tabId": "tab id to switch to when a matching tab already exists",
    "framePath": [1, 2],
    "shadowPath": [1],
    "value": "text to type, selected option, pressed key, or wait duration",
    "url": "URL to navigate to"
  }
}

If no action is needed, set action to null.
Prefer targetId when pageContext provides a clear visible control.
Use "index" only when there are multiple similar visible matches and ordinal targeting helps.
Use framePath or shadowPath only when they are needed to disambiguate the target.
Use the current subtask, not the full overall goal, to choose the next action.
Do not search for or type the entire overall goal sentence into a search box.
When opening another tab, use a direct URL or a short site-specific destination, not the full task text.
Use open_tab when you need another page or source to complete the goal.
Use switch_tab when the needed page is already open.`;

    const raw = await this.generateJson({
      operation: 'interpret_screen',
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
      operation: 'answer_screen_question',
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

  private async analyzeBrowserRescueDirect(params: BrowserRescueParams): Promise<GeminiBrowserRescueAnalysis> {
    const groundingBlock = this.getGroundingBlock(params.pageUrl, params.pageTitle);
    const pageContextBlock = this.getPageContextBlock(params.pageContext);
    const sourceModeBlock = this.getSourceModeBlock(params.sourceMode);
    const tabsBlock = this.getTabsBlock(params.tabs, params.activeTabId);
    const instructionBlock = typeof params.instruction === 'string' && params.instruction.trim()
      ? `\n\nUser request:\n${params.instruction.trim()}`
      : '';
    const historyBlock = params.history && params.history.length > 0
      ? `\n\nRecent failed or repeated steps:\n${params.history.slice(-8).map((step, index) => `${index + 1}. ${step}`).join('\n')}`
      : '';
    const failureBlock = params.failureContext
      ? `\n\nLatest failure:\n${params.failureContext}`
      : '';
    const goalBlock = params.overallGoal
      ? `\n\nOverall goal:\n${params.overallGoal}`
      : '';

    const prompt = `Current browser page rescue request.${instructionBlock}${groundingBlock}${sourceModeBlock}${tabsBlock}${pageContextBlock}${goalBlock}${failureBlock}${historyBlock}

Respond with valid JSON only.

Guidance:
- Summarize what this page is mainly for.
- Name the blockers that are most likely stopping the user.
- Suggest 2 to 3 short next steps.
- Use blocker objects with label and reason fields.
- Include an action object only when Sally could actually perform that next step.
- Prefer safe, reversible actions like focusing a field, closing a dialog, opening a menu, or clicking a non-destructive control.
- Never mark send, submit, delete, purchase, publish, sign-out, authentication, or permissions actions as safeToAutoExecute.`;

    const raw = await this.generateJson({
      operation: 'analyze_browser_rescue',
      systemInstruction: BROWSER_RESCUE_SYSTEM_PROMPT,
      prompt,
      screenshot: params.screenshot,
      maxOutputTokens: 512,
      temperature: 0.1,
      fallback: {
        pageSummary: 'I can inspect this page and help with the next step.',
        blockers: [],
        suggestions: [],
      },
    });

    return this.normalizeBrowserRescueAnalysis(raw);
  }

  private async interpretUserRequestDirect(params: InterpretUserRequestParams): Promise<GeminiUserRequestInterpretation> {
    const browserBlock = params.browserIsOpen
      ? `\n\nCurrent browser context:\n- Browser open: yes\n- URL: ${params.pageUrl || '(unknown)'}\n- Title: ${params.pageTitle || '(untitled)'}`
      : '\n\nCurrent browser context:\n- Browser open: no';
    const recentTurnsBlock = this.getRecentTurnsBlock(params.recentTurns);
    const clarificationBlock = this.getClarificationBlock(params.pendingClarificationQuestion);

    const prompt = `User message (${params.source}): "${params.transcript}"${browserBlock}${recentTurnsBlock}${clarificationBlock}

Respond with valid JSON only.

Guidance:
- If the user is asking Sally to go somewhere, search, click, type, compose, submit a form, or do a multi-step website action, use browser_task.
- If the user wants Sally to diagnose why they are stuck on a page, identify blockers, or suggest the next safe steps, use browser_rescue.
- Long multi-clause requests with several destinations, tabs, remembered facts, or email drafting are always browser_task unless a required entity is missing.
- If the user says they are stuck on the current page or wants Sally to pick the next helpful step, use browser_rescue.
- If they are asking what is on screen or what page elements exist, use describe_screen, summarize_screen, screen_question, or browser_assistive as appropriate.
- Requests about the desktop or current screen still count as screen intents when no browser is open.
- Do not respond with a browser-unavailable chat answer for an obvious describe_screen, summarize_screen, or screen_question request.
- If they are just talking to Sally or asking what Sally can do, use chat with a short spokenResponse.
- If the request is too vague to act on safely, use clarify with one short clarificationQuestion.
- Use normalizedInstruction to preserve the task in short plain language.`;

    const raw = await this.generateTextJson({
      operation: 'interpret_user_request',
      systemInstruction: USER_REQUEST_INTERPRETER_PROMPT,
      prompt,
      maxOutputTokens: 256,
      temperature: 0.1,
      fallback: {
        intent: 'clarify',
        confidence: 'low',
        normalizedInstruction: null,
        spokenResponse: null,
        clarificationQuestion: 'What would you like me to do?',
        browserAssistiveIntent: null,
      },
    });

    return this.normalizeUserRequestInterpretation(raw, params.transcript);
  }

  private async planComplexTaskDirect(params: PlanComplexTaskParams): Promise<GeminiTaskPlan> {
    const groundingBlock = this.getGroundingBlock(params.pageUrl, params.pageTitle);
    const pageContextBlock = this.getPageContextBlock(params.pageContext);
    const sourceModeBlock = this.getSourceModeBlock(params.sourceMode);
    const tabsBlock = this.getTabsBlock(params.tabs, params.activeTabId);
    const plannerStateBlock = this.getPlannerStateBlock(params);

    const prompt = `User goal: "${params.goal}"${groundingBlock}${sourceModeBlock}${tabsBlock}${pageContextBlock}${plannerStateBlock}

Respond with valid JSON only.

Guidance:
- Plan for a medium multi-step browser workflow.
- Use the current page and open tabs to avoid repeating work.
- Keep the activeSubtask narrow enough for Sally's next-action browser loop.
- Use rememberedFacts for reusable details the user may refer to later, like names, email addresses, dates, prices, or chosen links.
- If the goal spans multiple sites, tabs, or phases, create distinct subtasks for them.
- Reuse already-open Gmail, LinkedIn, and other relevant tabs when available.
- For research-then-draft tasks, gather and remember facts before moving to the drafting step.
- If the goal includes sending or submitting only after user approval, stop in a confirmation-ready state instead of marking the task complete.
- If "the company website" is requested without a specific company, ask a short clarification question.
- If the goal is already done, return status="complete".
- If the task genuinely needs user input, return status="clarify" with one short clarificationQuestion.
- If the task is blocked by the site or missing data, return status="blocked" with blockedReason.`;

    const raw = await this.generateTextJson({
      operation: 'plan_complex_task',
      systemInstruction: COMPLEX_TASK_PLANNER_PROMPT,
      prompt,
      maxOutputTokens: 512,
      temperature: 0.1,
      fallback: {
        status: 'continue',
        planSummary: params.goal,
        activeSubtask: params.activeSubtask || params.goal,
        subtasks: [
          {
            id: 's1',
            title: params.activeSubtask || params.goal,
            status: 'active',
          },
        ],
        rememberedFacts: params.workingMemory || [],
        clarificationQuestion: null,
        completionNarration: null,
        blockedReason: null,
      },
    });

    return this.normalizeTaskPlan(raw, params.goal);
  }

  private async generateEmailDraftDirect(params: GenerateEmailDraftParams): Promise<GeminiEmailDraft> {
    const prompt = `Email task:
- Goal: ${params.goal}
- Recipient: ${params.recipientEmail}
- User brief: ${params.brief}

Respond with valid JSON only.

Guidance:
- Write a polished email Sally can paste directly into Gmail.
- Generate a concise subject line.
- Use plain text only.
- Keep the body ready to send without further editing.
- Include a natural greeting and sign-off.
- When the brief mentions a date, keep it in the email.
- Do not mention that an AI wrote the email.`;

    const raw = await this.generateTextJson({
      operation: 'generate_email_draft',
      systemInstruction: EMAIL_DRAFT_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 512,
      temperature: 0.4,
      fallback: {
        subject: 'Quick follow-up',
        body: 'Hi,\n\nI wanted to follow up with you.\n\nBest,\nManoj',
      },
    });

    return this.normalizeEmailDraft(raw, params.brief);
  }

  private async generateJson(params: {
    operation: string;
    systemInstruction: string;
    prompt: string;
    screenshot: string;
    maxOutputTokens: number;
    temperature: number;
    fallback: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const genai = this.getDirectClient();
    const startedAt = Date.now();

    try {
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

      cloudLog('INFO', 'gemini_api_call', {
        endpoint: 'direct',
        operation: params.operation,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: true,
        usageMetadata: this.extractUsageMetadata(result),
      });

      return this.parseJsonResponse(result.text || '', params.fallback);
    } catch (error) {
      cloudLog('ERROR', 'gemini_api_call', {
        endpoint: 'direct',
        operation: params.operation,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: this.serializeError(error),
      });
      throw error;
    }
  }

  private async generateTextJson(params: {
    operation: string;
    systemInstruction: string;
    prompt: string;
    maxOutputTokens: number;
    temperature: number;
    fallback: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const genai = this.getDirectClient();
    const startedAt = Date.now();

    try {
      const result = await genai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [{ text: params.prompt }],
          },
        ],
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          maxOutputTokens: params.maxOutputTokens,
          temperature: params.temperature,
        },
      });

      cloudLog('INFO', 'gemini_api_call', {
        endpoint: 'direct',
        operation: params.operation,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: true,
        usageMetadata: this.extractUsageMetadata(result),
      });

      return this.parseJsonResponse(result.text || '', params.fallback);
    } catch (error) {
      cloudLog('ERROR', 'gemini_api_call', {
        endpoint: 'direct',
        operation: params.operation,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: this.serializeError(error),
      });
      throw error;
    }
  }

  private extractUsageMetadata(result: { usageMetadata?: GeminiUsageMetadata }): Record<string, number> | null {
    const usage = result.usageMetadata;
    if (!usage) {
      return null;
    }

    const metadata: Record<string, number> = {};

    if (typeof usage.promptTokenCount === 'number') metadata.promptTokenCount = usage.promptTokenCount;
    if (typeof usage.candidatesTokenCount === 'number') metadata.candidatesTokenCount = usage.candidatesTokenCount;
    if (typeof usage.totalTokenCount === 'number') metadata.totalTokenCount = usage.totalTokenCount;
    if (typeof usage.toolUsePromptTokenCount === 'number') metadata.toolUsePromptTokenCount = usage.toolUsePromptTokenCount;
    if (typeof usage.thoughtsTokenCount === 'number') metadata.thoughtsTokenCount = usage.thoughtsTokenCount;
    if (typeof usage.cachedContentTokenCount === 'number') metadata.cachedContentTokenCount = usage.cachedContentTokenCount;

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private serializeError(error: unknown): Record<string, string | null> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack || null,
      };
    }

    return {
      name: 'Error',
      message: String(error),
      stack: null,
    };
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
    return normalizeInterpretResultValue(raw);
  }

  private normalizeScreenQuestionResult(raw: Record<string, unknown>): GeminiScreenQuestionResult {
    return normalizeScreenQuestionResultValue(raw);
  }

  private normalizeBrowserRescueAnalysis(raw: Record<string, unknown>): GeminiBrowserRescueAnalysis {
    return normalizeBrowserRescueAnalysisValue(raw);
  }

  private normalizeUserRequestInterpretation(
    raw: Record<string, unknown>,
    transcript: string,
  ): GeminiUserRequestInterpretation {
    return normalizeUserRequestInterpretationValue(raw, transcript);
  }

  private normalizeTaskPlan(raw: Record<string, unknown>, goal: string): GeminiTaskPlan {
    return normalizeTaskPlanValue(raw, goal);
  }

  private normalizeEmailDraft(raw: Record<string, unknown>, brief: string): GeminiEmailDraft {
    return normalizeEmailDraftValue(raw, brief);
  }

}

export const geminiService = new GeminiService();
