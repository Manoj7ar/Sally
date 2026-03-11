// Session manager - orchestrates voice -> transcribe -> Electron browser + Gemini agentic loop -> TTS
import { windowManager } from '../windowManager.js';
import { whisperService } from '../services/whisperService.js';
import { ttsService } from '../services/ttsService.js';
import { geminiService } from '../services/geminiService.js';
import { screenshotService } from '../services/screenshotService.js';
import { browserService } from '../services/browserService.js';
import { destinationResolver } from '../services/destinationResolver.js';
import { apiKeyManager } from './apiKeyManager.js';
import type {
  GeminiAction,
  GeminiTaskPlan,
  GeminiTaskSubtask,
  GeminiUserRequestInterpretation,
  RecentUserTurn,
} from '../services/geminiService.js';
import type { TranscriptionResult } from '../services/whisperService.js';
import type { BrowserSnapshot } from '../services/pageContext.js';
import type { SallyState } from '../../../shared/types.js';

type BrowserAssistiveIntent = 'actions' | 'buttons' | 'fields' | 'errors' | 'links' | 'headings';
type ComplexTaskStatus = 'planning' | 'executing' | 'awaiting_confirmation' | 'completed' | 'failed';

interface ComplexTaskContext {
  goal: string;
  status: ComplexTaskStatus;
  planSummary: string;
  activeSubtask: string | null;
  subtasks: GeminiTaskSubtask[];
  workingMemory: string[];
  history: string[];
  failureCount: number;
  lastFailure: string | null;
  totalActions: number;
  actionsSincePlan: number;
  startTime: number;
  activeTabId: string | null;
  completionNarration: string | null;
  currentRunId: number;
}

interface PendingRiskyAction {
  action: GeminiAction;
  prompt: string;
  descriptor: string;
}

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
  /\bdescribe what (?:i am|i'm) looking at\b/i,
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
  /\bwho is this person\b/i,
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

const SCREEN_QUESTION_STARTER_PATTERN = /^(who|what|which|how many|how much|why|when|where|can you|could you|would you)\b/i;
const SCREEN_QUESTION_FALLBACK_CONTEXT_PATTERN = /\b(screen|page|image|photo|picture|people|persons|person|someone|somebody|man|woman|names?|name|face|faces|error|code|window)\b/i;
const FOLLOW_UP_CONTINUE_PATTERN = /\b(tell me more|more about|what about|read more|explain more|go on)\b/i;
const FOLLOW_UP_REFERENCE_PATTERN = /\b(this|that|it|them|those|these)\b/i;
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

const MAX_ITERATIONS = 40;
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const SETTLE_DELAY_MIN_MS = 800;
const MAX_RECENT_TURNS = 3;
const MAX_TASK_HISTORY = 16;
const MAX_TASK_MEMORY = 12;
const REPLAN_ACTION_INTERVAL = 5;
const REPLAN_FAILURE_THRESHOLD = 2;
const GENERIC_CHAT_RESPONSE = 'I can help you browse, describe what is on screen, answer screen questions, and walk through page controls.';
const GENERIC_CLARIFICATION_RESPONSE = 'What would you like me to do?';
const AFFIRMATIVE_CONFIRMATION_PATTERN = /\b(yes|yeah|yep|sure|go ahead|confirm|do it|send it|submit it|continue|proceed|okay)\b/i;
const NEGATIVE_CONFIRMATION_PATTERN = /\b(no|nope|stop|cancel that|don't|do not|not now|skip|hold off)\b/i;
const RISKY_ACTION_PATTERN = /\b(send|submit|purchase|buy|checkout|place order|delete|remove|discard|publish|post|log out|logout|sign out)\b/i;

class SessionManager {
  private state: SallyState = 'idle';
  private isCancelled = false;
  private runGeneration = 0;
  private waitTimeout: NodeJS.Timeout | null = null;
  private recentTurns: RecentUserTurn[] = [];
  private pendingClarificationQuestion: string | null = null;
  private currentTask: ComplexTaskContext | null = null;
  private sessionWorkingMemory: string[] = [];
  private pendingRiskyAction: PendingRiskyAction | null = null;

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

    if (SCREEN_QUESTION_STARTER_PATTERN.test(normalized) && SCREEN_QUESTION_FALLBACK_CONTEXT_PATTERN.test(normalized)) {
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

  private isExplicitCancel(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized === 'cancel' || normalized === 'stop' || normalized.includes('cancel');
  }

  private canUseSemanticInterpreter(): boolean {
    return apiKeyManager.hasGeminiApiKey() || Boolean(apiKeyManager.getGeminiBackendUrl());
  }

  private addRecentTurn(turn: RecentUserTurn): void {
    if (!turn.user.trim()) {
      return;
    }

    this.recentTurns.push(turn);
    if (this.recentTurns.length > MAX_RECENT_TURNS) {
      this.recentTurns.splice(0, this.recentTurns.length - MAX_RECENT_TURNS);
    }
  }

  private clearPendingClarification(): void {
    this.pendingClarificationQuestion = null;
  }

  private clearPendingRiskyAction(): void {
    this.pendingRiskyAction = null;
  }

  private mergeWorkingMemory(...groups: Array<string[] | undefined>): string[] {
    const merged: string[] = [];

    for (const group of groups) {
      for (const item of group || []) {
        const normalized = item.trim();
        if (!normalized) {
          continue;
        }

        if (merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
          continue;
        }

        merged.push(normalized);
        if (merged.length >= MAX_TASK_MEMORY) {
          return merged;
        }
      }
    }

    return merged;
  }

  private recordTaskHistory(context: ComplexTaskContext, entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) {
      return;
    }

    context.history.push(trimmed);
    if (context.history.length > MAX_TASK_HISTORY) {
      context.history.splice(0, context.history.length - MAX_TASK_HISTORY);
    }
  }

  private createTaskContext(goal: string, runId: number): ComplexTaskContext {
    const trimmedGoal = goal.trim();
    return {
      goal: trimmedGoal,
      status: 'planning',
      planSummary: trimmedGoal,
      activeSubtask: trimmedGoal,
      subtasks: [
        {
          id: 's1',
          title: trimmedGoal,
          status: 'active',
        },
      ],
      workingMemory: this.mergeWorkingMemory(this.sessionWorkingMemory),
      history: [],
      failureCount: 0,
      lastFailure: null,
      totalActions: 0,
      actionsSincePlan: 0,
      startTime: Date.now(),
      activeTabId: null,
      completionNarration: null,
      currentRunId: runId,
    };
  }

  private persistTaskMemory(context: ComplexTaskContext | null): void {
    if (!context) {
      return;
    }

    this.sessionWorkingMemory = this.mergeWorkingMemory(context.workingMemory, this.sessionWorkingMemory);
  }

  private applyTaskPlan(context: ComplexTaskContext, plan: GeminiTaskPlan): void {
    context.planSummary = plan.planSummary || context.goal;
    context.activeSubtask = plan.activeSubtask || plan.subtasks.find((subtask) => subtask.status === 'active')?.title || plan.subtasks.find((subtask) => subtask.status === 'pending')?.title || context.activeSubtask;
    context.subtasks = plan.subtasks.length > 0 ? plan.subtasks : context.subtasks;
    context.workingMemory = this.mergeWorkingMemory(context.workingMemory, plan.rememberedFacts);
    context.completionNarration = plan.completionNarration || context.completionNarration;
    context.actionsSincePlan = 0;
    context.status = plan.status === 'complete'
      ? 'completed'
      : plan.status === 'blocked'
        ? 'failed'
        : plan.status === 'clarify'
          ? 'planning'
          : 'executing';
  }

  private isAffirmativeConfirmation(text: string): boolean {
    return AFFIRMATIVE_CONFIRMATION_PATTERN.test(text);
  }

  private isNegativeConfirmation(text: string): boolean {
    return NEGATIVE_CONFIRMATION_PATTERN.test(text);
  }

  private describeTaskStep(context: ComplexTaskContext): string {
    return context.activeSubtask || context.planSummary || context.goal;
  }

  private findActionDescriptor(action: GeminiAction, snapshot: BrowserSnapshot): string {
    if (action.type === 'open_tab' || action.type === 'switch_tab') {
      return action.selector || action.url || action.tabId || 'that tab';
    }

    const normalizedSelector = action.selector?.trim().toLowerCase();
    const match = snapshot.pageContext.interactiveElements.find((element) => {
      if (action.targetId && element.targetId === action.targetId) {
        return true;
      }

      if (!normalizedSelector) {
        return false;
      }

      return [element.label, element.text, element.placeholder]
        .filter((value): value is string => typeof value === 'string' && Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedSelector));
    });

    return match?.label || match?.text || match?.placeholder || action.selector || action.value || action.url || action.type;
  }

  private buildRiskyActionPrompt(action: GeminiAction, snapshot: BrowserSnapshot): { prompt: string; descriptor: string } | null {
    if (!['click', 'press', 'select', 'check', 'uncheck'].includes(action.type)) {
      return null;
    }

    const descriptor = this.findActionDescriptor(action, snapshot);
    if (!RISKY_ACTION_PATTERN.test(descriptor)) {
      return null;
    }

    const prompt = `I am ready to ${descriptor}. Please say yes to confirm or no to cancel that step.`;
    return { prompt, descriptor };
  }

  private async refreshTaskPlan(
    context: ComplexTaskContext,
    snapshot: BrowserSnapshot | null,
    triggerReason: string,
    runId: number,
  ): Promise<GeminiTaskPlan | null> {
    if (!this.isRunCurrent(runId)) {
      return null;
    }

    const plan = await geminiService.planComplexTask({
      goal: context.goal,
      currentPlanSummary: context.planSummary,
      activeSubtask: context.activeSubtask,
      subtasks: context.subtasks,
      history: context.history,
      workingMemory: context.workingMemory,
      failureCount: context.failureCount,
      lastFailure: context.lastFailure,
      pageUrl: snapshot?.pageUrl,
      pageTitle: snapshot?.pageTitle,
      pageContext: snapshot?.pageContext,
      sourceMode: snapshot?.sourceMode,
      tabs: snapshot?.tabs,
      activeTabId: snapshot?.activeTabId,
      triggerReason,
    });

    this.applyTaskPlan(context, plan);
    this.persistTaskMemory(context);
    return plan;
  }

  private async handlePendingRiskyActionResponse(text: string, runId: number): Promise<boolean> {
    if (!this.pendingRiskyAction || !this.currentTask) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    if (this.isExplicitCancel(trimmed) || this.isNegativeConfirmation(trimmed)) {
      const descriptor = this.pendingRiskyAction.descriptor;
      this.recordTaskHistory(this.currentTask, `SKIPPED: User declined risky action "${descriptor}"`);
      this.clearPendingRiskyAction();
      this.currentTask.status = 'executing';
      this.broadcastChat('assistant', `Okay, I won't ${descriptor}.`);
      await ttsService.speakImmediate(`Okay, I won't ${descriptor}.`);
      await this.runPlannedBrowserTask(this.currentTask, runId, {
        skipIntro: true,
        forcePlanReason: 'risky_action_declined',
      });
      return true;
    }

    if (this.isAffirmativeConfirmation(trimmed)) {
      const pending = this.pendingRiskyAction;
      this.clearPendingRiskyAction();
      this.currentTask.status = 'executing';
      this.setState('acting');

      const actionResult = await browserService.executeAction(pending.action);
      if (!this.isRunCurrent(runId) || !this.currentTask) {
        return true;
      }

      const actionDesc = this.describeAction(pending.action, actionResult);
      const succeeded = this.didActionSucceed(actionResult);
      this.recordTaskHistory(this.currentTask, succeeded ? actionDesc : `FAILED: ${actionDesc}`);
      if (succeeded) {
        this.currentTask.failureCount = 0;
        this.currentTask.lastFailure = null;
        this.currentTask.totalActions += 1;
        this.currentTask.actionsSincePlan += 1;
      } else {
        this.currentTask.failureCount += 1;
        this.currentTask.lastFailure = actionResult;
      }

      windowManager.broadcastToAll('sally:step', {
        action: pending.action.type,
        details: actionResult,
        timestamp: Date.now(),
      });

      await this.waitForSettle(pending.action.type, runId);
      await this.runPlannedBrowserTask(this.currentTask, runId, {
        skipIntro: true,
        forcePlanReason: 'risky_action_confirmed',
      });
      return true;
    }

    if (this.isRunCurrent(runId)) {
      this.setState('awaiting_response');
    }
    this.broadcastChat('assistant', this.pendingRiskyAction.prompt);
    await ttsService.speakImmediate(this.pendingRiskyAction.prompt);
    if (this.isRunCurrent(runId)) {
      this.setState('awaiting_response');
    }
    return true;
  }

  private broadcastChat(role: 'assistant' | 'user', text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    windowManager.broadcastToAll('sally:chat', {
      role,
      text: trimmed,
    });
  }

  private buildLegacyInterpretation(text: string): GeminiUserRequestInterpretation {
    const trimmed = text.trim();
    const browserAssistiveIntent = this.normalizeBrowserAssistiveIntent(trimmed);
    const summarizeIntent = this.normalizeSummarizeIntent(trimmed);
    const describeIntent = this.normalizeDescribeIntent(trimmed);
    const screenQuestionIntent = this.normalizeScreenQuestionIntent(trimmed);
    const expandedSmartCommand = this.expandSmartCommand(trimmed);

    if (!trimmed) {
      return {
        intent: 'none',
        confidence: 'low',
        normalizedInstruction: null,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (this.isExplicitCancel(trimmed)) {
      return {
        intent: 'cancel',
        confidence: 'high',
        normalizedInstruction: 'cancel',
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (summarizeIntent) {
      return {
        intent: 'summarize_screen',
        confidence: 'high',
        normalizedInstruction: summarizeIntent,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (describeIntent) {
      return {
        intent: 'describe_screen',
        confidence: 'high',
        normalizedInstruction: describeIntent,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (screenQuestionIntent) {
      return {
        intent: 'screen_question',
        confidence: 'high',
        normalizedInstruction: screenQuestionIntent,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (browserAssistiveIntent) {
      return {
        intent: 'browser_assistive',
        confidence: 'high',
        normalizedInstruction: trimmed,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent,
      };
    }

    if (expandedSmartCommand !== trimmed) {
      return {
        intent: 'smart_home',
        confidence: 'high',
        normalizedInstruction: trimmed,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (/^(?:what can you do|help|how does this work|what do you do)\b/i.test(trimmed)) {
      return {
        intent: 'chat',
        confidence: 'medium',
        normalizedInstruction: trimmed,
        spokenResponse: GENERIC_CHAT_RESPONSE,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (this.isLikelyActionableVoiceCommand(trimmed)) {
      return {
        intent: 'browser_task',
        confidence: 'medium',
        normalizedInstruction: this.resolveVoiceInstruction(trimmed) || trimmed,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    return {
      intent: this.pendingClarificationQuestion ? 'clarify' : 'none',
      confidence: 'low',
      normalizedInstruction: trimmed || null,
      spokenResponse: null,
      clarificationQuestion: this.pendingClarificationQuestion ? GENERIC_CLARIFICATION_RESPONSE : null,
      browserAssistiveIntent: null,
    };
  }

  private getLastMeaningfulTurn(): RecentUserTurn | null {
    for (let index = this.recentTurns.length - 1; index >= 0; index -= 1) {
      const turn = this.recentTurns[index];
      if (!turn?.intent) {
        continue;
      }

      if (turn.intent === 'clarify' || turn.intent === 'none' || turn.intent === 'chat') {
        continue;
      }

      return turn;
    }

    return null;
  }

  private buildForcedInterpretation(
    intent: GeminiUserRequestInterpretation['intent'],
    normalizedInstruction: string,
    overrides: Partial<GeminiUserRequestInterpretation> = {},
  ): GeminiUserRequestInterpretation {
    return {
      intent,
      confidence: 'high',
      normalizedInstruction,
      spokenResponse: null,
      clarificationQuestion: null,
      browserAssistiveIntent: null,
      ...overrides,
    };
  }

  private getFollowUpInterpretation(text: string): GeminiUserRequestInterpretation | null {
    const trimmed = text.trim();
    const normalized = trimmed.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    if (!FOLLOW_UP_CONTINUE_PATTERN.test(normalized) || !FOLLOW_UP_REFERENCE_PATTERN.test(normalized)) {
      return null;
    }

    const lastTurn = this.getLastMeaningfulTurn();
    if (!lastTurn?.intent) {
      return null;
    }

    switch (lastTurn.intent) {
      case 'screen_question':
        return this.buildForcedInterpretation('screen_question', trimmed);

      case 'describe_screen':
      case 'summarize_screen':
        return this.buildForcedInterpretation('screen_question', trimmed);

      case 'browser_assistive':
        return this.buildForcedInterpretation('browser_assistive', trimmed, {
          browserAssistiveIntent: lastTurn.browserAssistiveIntent || 'actions',
        });

      default:
        return null;
    }
  }

  private hasStrongScreenQuestionShape(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    if (SCREEN_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    return /\b(who|how many|count|error|name|names|person|people|face|faces)\b/i.test(normalized);
  }

  private applyInterpretationGuards(
    text: string,
    interpretation: GeminiUserRequestInterpretation,
  ): GeminiUserRequestInterpretation {
    const trimmed = text.trim();
    if (!trimmed) {
      return interpretation;
    }

    const followUpInterpretation = this.getFollowUpInterpretation(trimmed);
    if (followUpInterpretation) {
      return followUpInterpretation;
    }

    const summarizeIntent = this.normalizeSummarizeIntent(trimmed);
    if (summarizeIntent) {
      return interpretation.intent === 'summarize_screen'
        ? interpretation
        : this.buildForcedInterpretation('summarize_screen', summarizeIntent);
    }

    const browserAssistiveIntent = this.normalizeBrowserAssistiveIntent(trimmed);
    if (browserAssistiveIntent) {
      return interpretation.intent === 'browser_assistive'
        ? { ...interpretation, browserAssistiveIntent: interpretation.browserAssistiveIntent || browserAssistiveIntent }
        : this.buildForcedInterpretation('browser_assistive', trimmed, {
            browserAssistiveIntent,
          });
    }

    const screenQuestionIntent = this.normalizeScreenQuestionIntent(trimmed);
    if (
      screenQuestionIntent
      && this.hasStrongScreenQuestionShape(trimmed)
    ) {
      return interpretation.intent === 'screen_question'
        ? interpretation
        : this.buildForcedInterpretation('screen_question', screenQuestionIntent);
    }

    const describeIntent = this.normalizeDescribeIntent(trimmed);
    if (describeIntent) {
      return interpretation.intent === 'describe_screen'
        ? interpretation
        : this.buildForcedInterpretation('describe_screen', describeIntent);
    }

    if (screenQuestionIntent) {
      return interpretation.intent === 'screen_question'
        ? interpretation
        : this.buildForcedInterpretation('screen_question', screenQuestionIntent);
    }

    const expandedSmartCommand = this.expandSmartCommand(trimmed);
    if (expandedSmartCommand !== trimmed && interpretation.intent !== 'smart_home') {
      return this.buildForcedInterpretation('smart_home', trimmed);
    }

    return interpretation;
  }

  private async interpretUserRequest(
    text: string,
    source: 'voice' | 'typed',
  ): Promise<GeminiUserRequestInterpretation> {
    const trimmed = text.trim();
    if (!trimmed) {
      return this.buildLegacyInterpretation(trimmed);
    }

    if (this.isExplicitCancel(trimmed)) {
      return {
        intent: 'cancel',
        confidence: 'high',
        normalizedInstruction: 'cancel',
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (!this.canUseSemanticInterpreter()) {
      return this.applyInterpretationGuards(trimmed, this.buildLegacyInterpretation(trimmed));
    }

    const pageInfo = await this.getCurrentPageInfo();

    try {
      const interpretation = await geminiService.interpretUserRequest({
        transcript: trimmed,
        source,
        browserIsOpen: browserService.isRunning(),
        pageUrl: pageInfo?.url,
        pageTitle: pageInfo?.title,
        recentTurns: this.recentTurns,
        pendingClarificationQuestion: this.pendingClarificationQuestion,
      });
      return this.applyInterpretationGuards(trimmed, interpretation);
    } catch (error) {
      console.warn('[SessionManager] Semantic interpreter failed, falling back to legacy routing:', error);
      return this.applyInterpretationGuards(trimmed, this.buildLegacyInterpretation(trimmed));
    }
  }

  private logInterpretation(text: string, interpretation: GeminiUserRequestInterpretation): void {
    console.log('[SessionManager] Interpreted request:', text, {
      intent: interpretation.intent,
      confidence: interpretation.confidence,
      normalizedInstruction: interpretation.normalizedInstruction,
      browserAssistiveIntent: interpretation.browserAssistiveIntent,
      hasSpokenResponse: Boolean(interpretation.spokenResponse),
      clarificationQuestion: interpretation.clarificationQuestion,
    });
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
    if (!browserService.isRunning()) {
      return null;
    }

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

      const transcript = transcription.transcript.trim();
      if (!transcript) {
        if (this.isRunCurrent(runId)) {
          ttsService.speakImmediate('Do you need help with anything else?');
          this.setState('idle');
        }
        return '';
      }

      if (transcription.intent === 'cancel' || this.isExplicitCancel(transcript)) {
        if (!this.isRunCurrent(runId)) {
          return transcript;
        }
        await this.cancel();
        return transcript;
      }

      this.executeTaskForRun(transcript, runId, 'voice').catch((error) => {
        if (!this.isRunCurrent(runId)) {
          return;
        }
        console.error('[SessionManager] Task execution failed:', error);
        ttsService.speakImmediate('Something went wrong. Please try again.');
        this.setState('idle');
      });

      return transcript;
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
    this.setState('processing');
    await this.executeTaskForRun(text, runId, 'typed');
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

  private async executeTaskForRun(text: string, runId: number, source: 'voice' | 'typed'): Promise<string> {
    if (!this.isRunCurrent(runId)) return '';

    const trimmed = text.trim();
    if (!trimmed) {
      if (this.isRunCurrent(runId)) {
        ttsService.speakImmediate("I didn't catch that clearly. Please say it again.");
        this.setState('idle');
      }
      return '';
    }

    this.broadcastChat('user', trimmed);

    if (await this.handlePendingRiskyActionResponse(trimmed, runId)) {
      return trimmed;
    }

    const interpretation = await this.interpretUserRequest(trimmed, source);
    if (!this.isRunCurrent(runId)) {
      return trimmed;
    }

    this.logInterpretation(trimmed, interpretation);

    switch (interpretation.intent) {
      case 'cancel':
        this.clearPendingClarification();
        this.clearPendingRiskyAction();
        await this.cancel();
        return 'cancel';

      case 'describe_screen':
        this.clearPendingClarification();
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
        });
        await this.describeScreen(runId);
        return interpretation.normalizedInstruction || trimmed;

      case 'summarize_screen':
        this.clearPendingClarification();
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
        });
        await this.summarizeScreen(runId);
        return interpretation.normalizedInstruction || trimmed;

      case 'screen_question':
        this.clearPendingClarification();
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
        });
        await this.answerScreenQuestion(interpretation.normalizedInstruction || trimmed, runId);
        return interpretation.normalizedInstruction || trimmed;

      case 'browser_assistive': {
        const browserAssistiveIntent = interpretation.browserAssistiveIntent || 'actions';
        this.clearPendingClarification();
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
          browserAssistiveIntent,
        });
        await this.handleAssistiveBrowserCommand(browserAssistiveIntent, runId);
        return interpretation.normalizedInstruction || trimmed;
      }

      case 'smart_home': {
        this.clearPendingClarification();
        this.clearPendingRiskyAction();
        const normalizedInstruction = interpretation.normalizedInstruction || trimmed;
        const expanded = this.expandSmartCommand(normalizedInstruction);
        if (expanded !== normalizedInstruction) {
          console.log('[SessionManager] Smart command expanded:', normalizedInstruction, '->', expanded);
        }
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction,
        });
        this.currentTask = this.createTaskContext(expanded, runId);
        await this.runPlannedBrowserTask(this.currentTask, runId);
        return expanded;
      }

      case 'browser_task': {
        this.clearPendingClarification();
        this.clearPendingRiskyAction();
        const normalizedInstruction = interpretation.normalizedInstruction || trimmed;
        this.addRecentTurn({
          user: trimmed,
          intent: interpretation.intent,
          normalizedInstruction,
        });
        this.currentTask = this.createTaskContext(normalizedInstruction, runId);
        await this.runPlannedBrowserTask(this.currentTask, runId);
        return normalizedInstruction;
      }

      case 'chat': {
        this.clearPendingClarification();
        const response = interpretation.spokenResponse || GENERIC_CHAT_RESPONSE;
        this.addRecentTurn({
          user: trimmed,
          assistant: response,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
        });
        this.broadcastChat('assistant', response);
        await ttsService.speakImmediate(response);
        if (this.isRunCurrent(runId)) {
          this.setState('idle');
        }
        return response;
      }

      case 'clarify': {
        const question = interpretation.clarificationQuestion || GENERIC_CLARIFICATION_RESPONSE;
        this.pendingClarificationQuestion = question;
        this.addRecentTurn({
          user: trimmed,
          assistant: question,
          intent: interpretation.intent,
          normalizedInstruction: interpretation.normalizedInstruction,
        });
        if (this.isRunCurrent(runId)) {
          this.setState('awaiting_response');
        }
        this.broadcastChat('assistant', question);
        await ttsService.speakImmediate(question);
        if (this.isRunCurrent(runId)) {
          this.setState('awaiting_response');
        }
        return question;
      }

      case 'none':
      default: {
        const response = this.pendingClarificationQuestion
          ? "Sorry, I still didn't catch that. Let's try again."
          : "I didn't catch that clearly. Please say it again.";
        this.clearPendingClarification();
        this.clearPendingRiskyAction();
        this.broadcastChat('assistant', response);
        await ttsService.speakImmediate(response);
        if (this.isRunCurrent(runId)) {
          this.setState('idle');
        }
        return '';
      }
    }
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
      const previewText = transcription.transcript.trim();
      if (previewText) {
        console.log('[SessionManager] Live preview transcription:', previewText);
        return previewText;
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
    const existing = this.currentTask;
    if (!existing || existing.goal !== instruction || existing.currentRunId !== runId) {
      this.currentTask = this.createTaskContext(instruction, runId);
    }

    if (this.currentTask) {
      await this.runPlannedBrowserTask(this.currentTask, runId, options);
      return;
    }

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

  private async runPlannedBrowserTask(
    context: ComplexTaskContext,
    runId: number,
    options: { skipIntro?: boolean; forcePlanReason?: string } = {},
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

    context.currentRunId = runId;
    this.currentTask = context;
    this.setState('acting');

    let forcePlanReason = options.forcePlanReason || (context.totalActions === 0 ? 'task_start' : null);

    try {
      if (!options.skipIntro && context.totalActions === 0 && context.history.length === 0) {
        await ttsService.speakImmediate("On it! Let me handle that for you.");
      }

      const initialUrl = context.totalActions === 0 && context.history.length === 0
        ? await this.deriveInitialBrowserUrl(context.goal)
        : null;
      await browserService.launch(initialUrl || undefined);
      const launchNotice = browserService.consumeLaunchNotice();
      if (launchNotice) {
        await ttsService.speakImmediate(launchNotice);
      }
      await this.syncOverlayTargetFromBrowser(runId);

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (!this.isRunCurrent(runId)) {
          return;
        }

        if (Date.now() - context.startTime > MAX_DURATION_MS) {
          context.status = 'failed';
          const response = "This is taking a while, so I'll stop here. You can try again with a simpler request.";
          this.broadcastChat('assistant', response);
          await ttsService.speakImmediate(response);
          break;
        }

        console.log(`[SessionManager] Planned loop iteration ${i + 1}/${MAX_ITERATIONS}`, {
          goal: context.goal,
          subtask: context.activeSubtask,
          planSummary: context.planSummary,
        });

        await this.syncOverlayTargetFromBrowser(runId);
        if (!this.isRunCurrent(runId)) return;

        const snapshot = await this.captureActiveBrowserSnapshot(runId);
        if (!snapshot) {
          context.failureCount += 1;
          context.lastFailure = 'Could not capture browser snapshot';
          this.recordTaskHistory(context, 'FAILED: Could not capture browser snapshot');
          if (context.failureCount >= REPLAN_FAILURE_THRESHOLD) {
            forcePlanReason = 'snapshot_failure';
          }
          await new Promise((resolve) => setTimeout(resolve, 1_200));
          continue;
        }

        context.activeTabId = snapshot.activeTabId;

        if (
          forcePlanReason
          || context.totalActions === 0
          || context.actionsSincePlan >= REPLAN_ACTION_INTERVAL
          || context.failureCount >= REPLAN_FAILURE_THRESHOLD
        ) {
          try {
            const plan = await Promise.race([
              this.refreshTaskPlan(context, snapshot, forcePlanReason || 'planner_refresh', runId),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Planner timeout')), 30_000)),
            ]);

            if (!this.isRunCurrent(runId) || !plan) {
              return;
            }

            forcePlanReason = null;
            if (plan.status === 'clarify' && plan.clarificationQuestion) {
              this.pendingClarificationQuestion = plan.clarificationQuestion;
              this.persistTaskMemory(context);
              this.broadcastChat('assistant', plan.clarificationQuestion);
              this.setState('awaiting_response');
              await ttsService.speakImmediate(plan.clarificationQuestion);
              if (this.isRunCurrent(runId)) {
                this.setState('awaiting_response');
              }
              return;
            }

            if (plan.status === 'blocked') {
              const response = plan.blockedReason || "I'm blocked on that task right now.";
              context.status = 'failed';
              this.broadcastChat('assistant', response);
              await ttsService.speakImmediate(response);
              break;
            }

            if (plan.status === 'complete') {
              context.status = 'completed';
              const response = plan.completionNarration || 'That task is complete.';
              this.broadcastChat('assistant', response);
              await ttsService.speakImmediate(response);
              break;
            }
          } catch (error) {
            if (!this.isRunCurrent(runId)) {
              return;
            }
            console.warn('[SessionManager] Planner refresh failed, continuing with current plan:', error);
            forcePlanReason = null;
          }
        }

        let result: import('../services/geminiService.js').GeminiInterpretResult;
        try {
          result = await Promise.race([
            geminiService.interpretScreen({
              screenshot: snapshot.screenshot,
              instruction: context.goal,
              history: context.history,
              pageUrl: snapshot.pageUrl,
              pageTitle: snapshot.pageTitle,
              pageContext: snapshot.pageContext,
              sourceMode: snapshot.sourceMode,
              tabs: snapshot.tabs,
              activeTabId: snapshot.activeTabId,
              overallGoal: context.goal,
              planSummary: context.planSummary,
              activeSubtask: this.describeTaskStep(context),
              workingMemory: context.workingMemory,
              failureContext: context.lastFailure,
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 30_000)),
          ]);
        } catch (error) {
          if (!this.isRunCurrent(runId)) {
            return;
          }
          console.error('[SessionManager] Gemini call failed:', error);
          context.failureCount += 1;
          context.lastFailure = error instanceof Error ? error.message : String(error);
          this.recordTaskHistory(context, `FAILED: Gemini error - ${context.lastFailure}`);
          if (context.failureCount >= REPLAN_FAILURE_THRESHOLD) {
            forcePlanReason = 'gemini_failure';
          }
          continue;
        }

        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Gemini result:', result.narration, result.action);

        if (result.narration) {
          this.broadcastChat('assistant', result.narration);
          ttsService.speak(result.narration);
        }

        if (!result.action || result.action.type === 'null') {
          this.recordTaskHistory(context, `COMPLETED: ${this.describeTaskStep(context)}`);
          context.subtasks = context.subtasks.map((subtask) => (
            subtask.title === context.activeSubtask && subtask.status === 'active'
              ? { ...subtask, status: 'done' }
              : subtask
          ));
          context.activeSubtask = null;
          forcePlanReason = 'subtask_complete';
          continue;
        }

        const riskyAction = this.buildRiskyActionPrompt(result.action, snapshot);
        if (riskyAction) {
          this.pendingRiskyAction = {
            action: result.action,
            prompt: riskyAction.prompt,
            descriptor: riskyAction.descriptor,
          };
          context.status = 'awaiting_confirmation';
          this.persistTaskMemory(context);
          this.broadcastChat('assistant', riskyAction.prompt);
          this.setState('awaiting_response');
          await ttsService.speakImmediate(riskyAction.prompt);
          if (this.isRunCurrent(runId)) {
            this.setState('awaiting_response');
          }
          return;
        }

        const actionResult = await browserService.executeAction(result.action);
        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Action result:', actionResult);

        const succeeded = this.didActionSucceed(actionResult);
        const actionDesc = this.describeAction(result.action, actionResult);
        this.recordTaskHistory(context, succeeded ? actionDesc : `FAILED: ${actionDesc}`);
        if (succeeded) {
          context.failureCount = 0;
          context.lastFailure = null;
          context.totalActions += 1;
          context.actionsSincePlan += 1;
        } else {
          context.failureCount += 1;
          context.lastFailure = actionResult;
        }

        windowManager.broadcastToAll('sally:step', {
          action: result.action.type,
          details: actionResult,
          timestamp: Date.now(),
        });

        await this.waitForSettle(result.action.type, runId);
        await this.syncOverlayTargetFromBrowser(runId);

        if (result.action.type === 'open_tab' || result.action.type === 'switch_tab') {
          forcePlanReason = `${result.action.type}_executed`;
        } else if (context.failureCount >= REPLAN_FAILURE_THRESHOLD) {
          forcePlanReason = 'repeated_action_failure';
        }
      }
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] Agentic browse failed:', error);
      context.status = 'failed';
      ttsService.stop();
      ttsService.speakImmediate("Something went wrong. Let me know if you'd like to try again.");
    } finally {
      this.persistTaskMemory(context);
      if (!this.pendingRiskyAction && (context.status === 'completed' || context.status === 'failed')) {
        this.currentTask = null;
      }
      if (this.isRunCurrent(runId) && !this.pendingRiskyAction) {
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

  private didActionSucceed(result: string): boolean {
    const successPrefixes = [
      'Navigated to',
      'Opened new tab',
      'Switched to tab',
      'Clicked',
      'Typed',
      'Selected',
      'Pressed',
      'Hovered',
      'Focused',
      'Checked',
      'Unchecked',
      'Scrolled',
      'Went back',
      'Waited',
    ];

    return successPrefixes.some((prefix) => result.startsWith(prefix));
  }

  private describeAction(action: GeminiAction, result: string): string {
    switch (action.type) {
      case 'navigate': return `Navigated to ${action.url}`;
      case 'open_tab': return `Opened new tab ${action.url || action.selector || ''}`.trim();
      case 'switch_tab': return `Switched to tab ${action.tabId || action.selector || action.url || action.index || ''}`.trim();
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
    this.clearPendingClarification();
    this.clearPendingRiskyAction();
    this.currentTask = null;
    this.sessionWorkingMemory = [];
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
