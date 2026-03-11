// Gemini Vision Service - optional backend with direct Gemini fallback
import { GoogleGenAI } from '@google/genai';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';
import type { BrowserSourceMode, BrowserTabInfo, PageContext } from './pageContext.js';

export interface GeminiAction {
  type: string;
  selector?: string;
  value?: string;
  url?: string;
  index?: number;
  tabId?: string;
  targetId?: string;
  framePath?: number[];
  shadowPath?: number[];
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

export type GeminiBrowserAssistiveIntent = 'actions' | 'buttons' | 'fields' | 'errors' | 'links' | 'headings';
export type GeminiUserRequestIntent =
  | 'browser_task'
  | 'browser_assistive'
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

const BACKEND_COOLDOWN_MS = 5 * 60 * 1000;
const BACKEND_TIMEOUT_MS = 8000;
const VALID_ACTION_TYPES = new Set([
  'navigate', 'click', 'fill', 'type', 'select', 'press',
  'hover', 'focus', 'check', 'uncheck', 'scroll', 'scroll_up', 'back', 'wait',
  'open_tab', 'switch_tab', 'null',
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
- Prefer targetId from pageContext when a visible control clearly matches.
- Use visible text, labels, placeholders, roles, and ordinal position for selectors.
- Include framePath or shadowPath only when they help disambiguate the target.
- Prefer structured controls from pageContext when available.
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

const USER_REQUEST_INTERPRETER_PROMPT = `You are Sally's request interpreter. Your job is to infer what the human means in natural language, not to force them into exact command phrases.

Return valid JSON only with this exact shape:
{
  "intent": "browser_task|browser_assistive|describe_screen|summarize_screen|screen_question|smart_home|chat|cancel|clarify|none",
  "confidence": "high|medium|low",
  "normalizedInstruction": "string or null",
  "spokenResponse": "short spoken answer or null",
  "clarificationQuestion": "one short follow-up question or null",
  "browserAssistiveIntent": "actions|buttons|fields|errors|links|headings|null"
}

Intent rules:
- Use browser_task when the user wants Sally to open, navigate, click, type, search, or do something in the browser.
- Use browser_assistive when the user is asking what they can do on the current page or wants visible buttons, links, fields, errors, or headings read out.
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
- Treat phrases like "describe my screen", "what's going on here", "summarize what I'm seeing", "who is this person", and "what error am I looking at" as screen intents.
- Treat phrases like "what can I do on this page" or "what buttons are here" as browser_assistive, even if Sally later needs to tell the user to open a page first.
- Prefer normalizedInstruction that preserves the user's meaning in short plain language.
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

  async interpretUserRequest(params: InterpretUserRequestParams): Promise<GeminiUserRequestInterpretation> {
    return this.withBackendFallback(
      (backendUrl) => this.interpretUserRequestWithBackend(backendUrl, params),
      () => this.interpretUserRequestDirect(params),
    );
  }

  async planComplexTask(params: PlanComplexTaskParams): Promise<GeminiTaskPlan> {
    return this.withBackendFallback(
      (backendUrl) => this.planComplexTaskWithBackend(backendUrl, params),
      () => this.planComplexTaskDirect(params),
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
Use open_tab when you need another page or source to complete the goal.
Use switch_tab when the needed page is already open.`;

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
- If they are asking what is on screen or what page elements exist, use describe_screen, summarize_screen, screen_question, or browser_assistive as appropriate.
- Requests about the desktop or current screen still count as screen intents when no browser is open.
- Do not respond with a browser-unavailable chat answer for an obvious describe_screen, summarize_screen, or screen_question request.
- If they are just talking to Sally or asking what Sally can do, use chat with a short spokenResponse.
- If the request is too vague to act on safely, use clarify with one short clarificationQuestion.
- Use normalizedInstruction to preserve the task in short plain language.`;

    const raw = await this.generateTextJson({
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
- If the goal is already done, return status="complete".
- If the task genuinely needs user input, return status="clarify" with one short clarificationQuestion.
- If the task is blocked by the site or missing data, return status="blocked" with blockedReason.`;

    const raw = await this.generateTextJson({
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

  private async generateTextJson(params: {
    systemInstruction: string;
    prompt: string;
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
      if (typeof candidate.tabId === 'string') action.tabId = candidate.tabId;
      if (typeof candidate.targetId === 'string') action.targetId = candidate.targetId;
      if (Array.isArray(candidate.framePath)) {
        action.framePath = candidate.framePath
          .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
          .map((item) => Math.floor(item));
      }
      if (Array.isArray(candidate.shadowPath)) {
        action.shadowPath = candidate.shadowPath
          .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
          .map((item) => Math.floor(item));
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

  private normalizeUserRequestInterpretation(
    raw: Record<string, unknown>,
    transcript: string,
  ): GeminiUserRequestInterpretation {
    const intent = this.normalizeUserRequestIntent(raw.intent);
    const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low';
    const normalizedInstruction = typeof raw.normalizedInstruction === 'string' && raw.normalizedInstruction.trim()
      ? raw.normalizedInstruction.trim()
      : transcript.trim() || null;
    const spokenResponse = typeof raw.spokenResponse === 'string' && raw.spokenResponse.trim()
      ? raw.spokenResponse.trim()
      : null;
    const clarificationQuestion = typeof raw.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
      ? raw.clarificationQuestion.trim()
      : null;
    const browserAssistiveIntent = this.normalizeBrowserAssistiveIntent(raw.browserAssistiveIntent);

    return {
      intent,
      confidence,
      normalizedInstruction,
      spokenResponse,
      clarificationQuestion,
      browserAssistiveIntent,
    };
  }

  private normalizeTaskPlan(raw: Record<string, unknown>, goal: string): GeminiTaskPlan {
    const status = raw.status === 'complete' || raw.status === 'blocked' || raw.status === 'clarify'
      ? raw.status
      : 'continue';
    const planSummary = typeof raw.planSummary === 'string' && raw.planSummary.trim()
      ? raw.planSummary.trim()
      : goal;
    const activeSubtask = typeof raw.activeSubtask === 'string' && raw.activeSubtask.trim()
      ? raw.activeSubtask.trim()
      : null;

    const subtasks: GeminiTaskSubtask[] = Array.isArray(raw.subtasks)
      ? raw.subtasks
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .slice(0, 6)
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `s${index + 1}`,
          title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Step ${index + 1}`,
          status: item.status === 'done' || item.status === 'blocked' || item.status === 'active'
            ? item.status
            : 'pending',
        }))
      : [];

    const rememberedFacts = Array.isArray(raw.rememberedFacts)
      ? raw.rememberedFacts
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, 12)
      : [];

    const clarificationQuestion = typeof raw.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
      ? raw.clarificationQuestion.trim()
      : null;
    const completionNarration = typeof raw.completionNarration === 'string' && raw.completionNarration.trim()
      ? raw.completionNarration.trim()
      : null;
    const blockedReason = typeof raw.blockedReason === 'string' && raw.blockedReason.trim()
      ? raw.blockedReason.trim()
      : null;

    const normalizedSubtasks: GeminiTaskSubtask[] = subtasks.length > 0
      ? subtasks
      : [
          {
            id: 's1',
            title: activeSubtask || goal,
            status: status === 'complete' ? 'done' : 'active',
          },
        ];

    return {
      status,
      planSummary,
      activeSubtask: activeSubtask || normalizedSubtasks.find((item) => item.status === 'active')?.title || normalizedSubtasks.find((item) => item.status === 'pending')?.title || null,
      subtasks: normalizedSubtasks,
      rememberedFacts,
      clarificationQuestion,
      completionNarration,
      blockedReason,
    };
  }

  private normalizeUserRequestIntent(value: unknown): GeminiUserRequestIntent {
    switch (value) {
      case 'browser_task':
      case 'browser_assistive':
      case 'describe_screen':
      case 'summarize_screen':
      case 'screen_question':
      case 'smart_home':
      case 'chat':
      case 'cancel':
      case 'clarify':
      case 'none':
        return value;
      default:
        return 'none';
    }
  }

  private normalizeBrowserAssistiveIntent(value: unknown): GeminiBrowserAssistiveIntent | null {
    switch (value) {
      case 'actions':
      case 'buttons':
      case 'fields':
      case 'errors':
      case 'links':
      case 'headings':
        return value;
      default:
        return null;
    }
  }
}

export const geminiService = new GeminiService();
