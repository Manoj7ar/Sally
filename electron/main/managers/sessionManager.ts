// Session manager - orchestrates voice -> transcribe -> Electron browser + Gemini agentic loop -> TTS
import { windowManager } from '../windowManager.js';
import { transcriptionService } from '../services/transcriptionService.js';
import { ttsService } from '../services/ttsService.js';
import { geminiService } from '../services/geminiService.js';
import { screenshotService } from '../services/screenshotService.js';
import { browserService } from '../services/browserService.js';
import { cloudLog } from '../services/cloudLogger.js';
import { destinationResolver } from '../services/destinationResolver.js';
import { apiKeyManager } from './apiKeyManager.js';
import type {
  GeminiAction,
  GeminiTaskPlan,
  GeminiTaskSubtask,
  GeminiUserRequestInterpretation,
  GeminiUserRequestIntent,
  RecentUserTurn,
} from '../services/geminiService.js';
import type { TranscriptionResult } from '../services/transcriptionService.js';
import type { BrowserSnapshot, PageContextElement } from '../services/pageContext.js';
import type { SallyState } from '../../../shared/types.js';

type BrowserAssistiveIntent = 'actions' | 'buttons' | 'fields' | 'errors' | 'links' | 'headings';
type ComplexTaskStatus = 'planning' | 'executing' | 'awaiting_confirmation' | 'completed' | 'failed';

interface BrowserRescueSuggestion {
  label: string;
  reason: string;
  action: GeminiAction | null;
  safeToAutoExecute: boolean;
}

interface BrowserRescueBlocker {
  label: string;
  reason: string;
}

interface BrowserRescueAnalysis {
  pageSummary: string;
  blockers: BrowserRescueBlocker[];
  suggestions: BrowserRescueSuggestion[];
}

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
  recentActions: Array<{ fingerprint: string; pageUrl: string; pageTitle: string }>;
  autoRescueUsed: boolean;
}

interface PendingRiskyAction {
  action: GeminiAction;
  prompt: string;
  descriptor: string;
  autoListenAttempts: number;
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
const BROWSER_RESCUE_PATTERNS = [
  /\bi(?: am|'m)\s+stuck\b/i,
  /\bhelp me here\b/i,
  /\bi do(?: not|n't) know what to do\b/i,
  /\bwhat should i do here\b/i,
  /\bhow do i get through this\b/i,
  /\bcan you help me get through this\b/i,
];
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
const ACTION_TARGET_PREVIEW_MS = 600;
const GENERIC_CHAT_RESPONSE = 'I can help you browse, describe what is on screen, answer screen questions, and walk through page controls.';
const GENERIC_CLARIFICATION_RESPONSE = 'What would you like me to do?';
const AFFIRMATIVE_CONFIRMATION_PATTERN = /\b(yes|yeah|yep|sure|go ahead|confirm|do it|send it|submit it|continue|proceed|okay)\b/i;
const NEGATIVE_CONFIRMATION_PATTERN = /\b(no|nope|stop|cancel that|don't|do not|not now|skip|hold off)\b/i;
const RISKY_ACTION_PATTERN = /\b(send|submit|purchase|buy|checkout|place order|delete|remove|discard|publish|post|log out|logout|sign out)\b/i;
const SAFE_DRAFT_ACTION_PATTERN = /\b(compose|new email|new message|draft|reply|reply all|forward)\b/i;
const EMAIL_DRAFT_STEP_PATTERN = /\b(draft|compose|write|email)\b/i;
const AUTO_CONFIRMATION_MAX_DURATION_MS = 4000;
const AUTO_CONFIRMATION_TRAILING_SILENCE_MS = 700;
const COMPLEX_BROWSER_ACTION_PATTERN = /\b(open|go to|navigate to|visit|take me to|bring me to|switch to|search|find|look up|research|draft|compose|email|write|remember|use|compare|figure out|look for)\b/gi;
const COMPLEX_BROWSER_SEQUENCE_PATTERN = /\b(in one tab|another tab|other tab|new tab|switch to|then|and then|after that|using those facts|using that|remember the key facts|remember those facts|before sending|before send)\b/gi;
const COMPLEX_BROWSER_DESTINATION_PATTERN = /\b(gmail|linkedin|google docs|google drive|google calendar|youtube|slack|github|notion|amazon|reddit|canva|calendar|drive|docs|website|official website|company website|site|email|tab)\b/gi;
const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

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

  private normalizeLooseText(text: string): string {
    return text.toLowerCase().replace(/[^\w\s'@.-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private countPatternMatches(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  private splitWorkflowClauses(text: string): string[] {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
      return [];
    }

    return collapsed
      .replace(/\s*;\s*/g, ', ')
      .replace(/\s+(?:and then|then|after that)\s+/gi, ', ')
      .split(/\s*,\s*/)
      .map((clause) => clause.replace(/^(?:and|then)\s+/i, '').trim())
      .filter(Boolean);
  }

  private looksLikeComplexBrowserWorkflow(text: string): boolean {
    const normalized = this.normalizeLooseText(text);
    if (!normalized) {
      return false;
    }

    if (
      this.normalizeSummarizeIntent(normalized)
      || this.normalizeDescribeIntent(normalized)
      || this.normalizeBrowserAssistiveIntent(normalized)
      || this.normalizeScreenQuestionIntent(normalized)
    ) {
      return false;
    }

    const actionHits = this.countPatternMatches(normalized, COMPLEX_BROWSER_ACTION_PATTERN);
    const sequenceHits = this.countPatternMatches(normalized, COMPLEX_BROWSER_SEQUENCE_PATTERN);
    const destinationHits = this.countPatternMatches(normalized, COMPLEX_BROWSER_DESTINATION_PATTERN);
    const clauseCount = this.splitWorkflowClauses(text).length;
    const hasEmail = EMAIL_ADDRESS_PATTERN.test(text);
    const hasRememberAndDraft = /\bremember\b/i.test(normalized) && /\b(draft|compose|email|write)\b/i.test(normalized);

    return (
      (actionHits >= 2 && (sequenceHits > 0 || destinationHits >= 2 || clauseCount >= 3 || hasEmail))
      || (sequenceHits >= 2 && (destinationHits > 0 || hasEmail))
      || (hasRememberAndDraft && (destinationHits > 0 || hasEmail))
      || (hasEmail && /\b(draft|compose|email|write)\b/i.test(normalized) && actionHits > 0)
    );
  }

  private formatComplexBrowserWorkflow(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
      return collapsed;
    }

    if (/^Browser workflow:\s*/i.test(text)) {
      return text.trim();
    }

    if (!this.looksLikeComplexBrowserWorkflow(collapsed)) {
      return collapsed;
    }

    const clauses = this.splitWorkflowClauses(collapsed);
    if (clauses.length < 2) {
      return collapsed;
    }

    const formattedClauses = clauses
      .slice(0, 6)
      .map((clause, index) => {
        const trimmed = clause.replace(/[.?!]+$/g, '').trim();
        const normalizedClause = trimmed
          ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
          : 'Continue the task';
        return `${index + 1}. ${normalizedClause}`;
      });

    return `Browser workflow:\n${formattedClauses.join('\n')}`;
  }

  private buildHeuristicSubtasks(goal: string): GeminiTaskSubtask[] {
    const trimmedGoal = goal.trim();
    const formatted = /^Browser workflow:\s*/i.test(trimmedGoal)
      ? trimmedGoal
      : this.formatComplexBrowserWorkflow(trimmedGoal);
    const clauses = /^Browser workflow:\s*/i.test(formatted)
      ? formatted
        .replace(/^Browser workflow:\s*/i, '')
        .split('\n')
        .map((line) => line.replace(/^\d+\.\s*/, '').replace(/[.?!]+$/g, '').trim())
        .filter(Boolean)
      : this.splitWorkflowClauses(trimmedGoal)
        .map((clause) => clause.replace(/[.?!]+$/g, '').trim())
        .filter(Boolean);

    if (clauses.length < 2) {
      const fallbackTitle = formatted || goal.trim();
      return [
        {
          id: 's1',
          title: fallbackTitle,
          status: 'active',
        },
      ];
    }

    return clauses.slice(0, 6).map((clause, index) => ({
      id: `s${index + 1}`,
      title: clause,
      status: index === 0 ? 'active' : 'pending',
    }));
  }

  private extractSeedTaskMemory(goal: string): string[] {
    const memory: string[] = [];
    const email = goal.match(EMAIL_ADDRESS_PATTERN)?.[0];
    if (email) {
      memory.push(`Recipient email: ${email}`);
    }

    const companyMatch = goal.match(/\bopen\s+(.+?)(?:'s|s)?\s+linkedin page\b/i)
      || goal.match(/\bopen\s+(.+?)(?:'s|s)?\s+official website\b/i)
      || goal.match(/\bfigure out what\s+(.+?)\s+does\b/i);
    if (companyMatch?.[1]) {
      memory.push(`Company: ${companyMatch[1].trim()}`);
    }

    if (/\bask me before (?:sending|send|submitting|submit)\b/i.test(goal)) {
      memory.push('Require confirmation before sending or submitting.');
    }

    return memory;
  }

  private getRememberedFactValue(context: ComplexTaskContext, prefix: string): string | null {
    const match = context.workingMemory.find((item) => item.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
    return match ? match.slice(prefix.length + 1).trim() : null;
  }

  private getRememberedFactValues(context: ComplexTaskContext, prefix: string): string[] {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixPattern = new RegExp(`^${escapedPrefix}(?:\\s+\\d+)?\\s*:`, 'i');
    return context.workingMemory
      .filter((item) => prefixPattern.test(item))
      .map((item) => item.replace(prefixPattern, '').trim())
      .filter(Boolean);
  }

  private slugifyLinkedInCompany(company: string): string {
    return company
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private buildOutreachDraftSubject(context: ComplexTaskContext): string {
    const company = this.getRememberedFactValue(context, 'Company');
    return company ? `Quick idea related to ${company}` : 'Quick outreach idea';
  }

  private buildOutreachDraftBody(context: ComplexTaskContext): string {
    const company = this.getRememberedFactValue(context, 'Company') || 'your team';
    const summary = this.getRememberedFactValue(context, 'Company summary');
    const facts = this.getRememberedFactValues(context, 'Company fact').slice(0, 5);
    const supportingLine = summary || `${company} appears to be doing interesting work across products and services.`;
    const bodyLines = [
      'Hi,',
      '',
      `I spent some time looking through ${company}'s recent web presence and wanted to reach out because ${supportingLine}`,
    ];

    if (facts.length > 0) {
      bodyLines.push(
        '',
        'A few things that stood out to me:',
        ...facts.map((fact) => `- ${fact}`),
      );
    }

    bodyLines.push(
      '',
      `That combination of products, platforms, and strategic focus makes ${company} especially interesting from a partnership and outreach perspective.`,
      `I would love to explore whether there could be a relevant conversation around what ${company} is building and where those priorities are headed next.`,
      '',
      'Best,',
      'Manoj',
    );

    return bodyLines.join('\n');
  }

  private hasRememberedCompanyFacts(context: ComplexTaskContext): boolean {
    return context.workingMemory.some((item) => /^Company (summary|fact)/i.test(item));
  }

  private extractFactSentences(answer: string): string[] {
    return answer
      .split(/[\n\r]+|(?<=[.?!])\s+/)
      .map((part) => part.replace(/^[-\u2022]\s*/, '').trim())
      .filter((part) => part.length >= 18)
      .slice(0, 5);
  }

  private isResearchToEmailWorkflow(context: ComplexTaskContext): boolean {
    const goal = this.normalizeLooseText(context.goal);
    return goal.includes('linkedin page')
      && goal.includes('official website')
      && goal.includes('switch to gmail')
      && /\bdraft\b/.test(goal)
      && Boolean(this.getRememberedFactValue(context, 'Company'))
      && Boolean(this.getRememberedFactValue(context, 'Recipient email'));
  }

  private findCompanySiteTab(snapshot: BrowserSnapshot, company: string): BrowserSnapshot['tabs'][number] | null {
    const companyLower = company.toLowerCase();
    return snapshot.tabs.find((tab) => (
      !tab.url.includes('linkedin.com')
      && !tab.url.includes('mail.google.com')
      && !tab.url.includes('google.com/search')
      && (tab.title.toLowerCase().includes(companyLower) || tab.url.toLowerCase().includes(companyLower.replace(/\s+/g, '')))
    )) || null;
  }

  private syncResearchToEmailWorkflowSubtasks(context: ComplexTaskContext, snapshot: BrowserSnapshot): void {
    if (!this.isResearchToEmailWorkflow(context)) {
      return;
    }

    const company = this.getRememberedFactValue(context, 'Company');
    if (!company) {
      return;
    }

    const companySlug = this.slugifyLinkedInCompany(company);
    const activeUrl = snapshot.pageUrl.toLowerCase();
    const linkedInReady = Boolean(companySlug) && snapshot.tabs.some((tab) => tab.url.toLowerCase().includes(`/company/${companySlug}/`));
    const companySiteReady = Boolean(this.findCompanySiteTab(snapshot, company));
    const factsReady = this.hasRememberedCompanyFacts(context);
    const gmailReady = factsReady && activeUrl.includes('mail.google.com');

    context.subtasks = context.subtasks.map((subtask) => {
      const normalized = this.normalizeLooseText(subtask.title);
      if (/\blinkedin page\b/i.test(normalized)) {
        return { ...subtask, status: linkedInReady ? 'done' : 'pending' };
      }
      if (/\b(official website|company website)\b/i.test(normalized)) {
        return { ...subtask, status: companySiteReady ? 'done' : 'pending' };
      }
      if (/\bfigure out what\b.*\bdoes\b/i.test(normalized)) {
        return { ...subtask, status: factsReady ? 'done' : 'pending' };
      }
      if (/\bremember\b.*\bkey facts\b|\bkey facts\b.*\bremember\b/i.test(normalized)) {
        return { ...subtask, status: factsReady ? 'done' : 'pending' };
      }
      if (/\bgmail\b/i.test(normalized)) {
        return { ...subtask, status: gmailReady ? 'done' : 'pending' };
      }
      if (/\bdraft\b/i.test(normalized)) {
        return { ...subtask, status: 'pending' };
      }
      return subtask;
    });

    let activated = false;
    context.subtasks = context.subtasks.map((subtask) => {
      if (subtask.status === 'done' || subtask.status === 'blocked') {
        return subtask;
      }
      if (!activated) {
        activated = true;
        return { ...subtask, status: 'active' };
      }
      return { ...subtask, status: 'pending' };
    });
    context.activeSubtask = context.subtasks.find((subtask) => subtask.status === 'active')?.title || null;
  }

  private buildFallbackCompanyFacts(company: string): string[] {
    const normalizedCompany = company.toLowerCase();

    if (normalizedCompany === 'apple') {
      return [
        'Company summary: Apple is a technology company that builds premium consumer devices, software platforms, semiconductor technology, and subscription-based digital services.',
        'Company fact 1: Apple makes flagship hardware products including the iPhone, Mac, iPad, Apple Watch, AirPods, and Vision Pro.',
        'Company fact 2: Apple runs a tightly integrated software ecosystem across iOS, macOS, iPadOS, watchOS, and visionOS.',
        'Company fact 3: Apple supports that ecosystem with services such as iCloud, the App Store, Apple Music, Apple TV+, Apple Pay, and AppleCare.',
        'Company fact 4: Apple also designs its own silicon, including Apple silicon chips that power newer Macs and other devices.',
        'Company fact 5: Apple positions privacy, device integration, and premium user experience as core parts of its brand and product strategy.',
      ];
    }

    if (normalizedCompany === 'google') {
      return [
        'Company summary: Google is a technology company that provides internet products, software platforms, AI systems, developer tools, advertising infrastructure, and cloud services.',
        'Company fact 1: Google operates widely used consumer products including Search, Gmail, YouTube, Maps, Chrome, Android, Photos, and Google Drive.',
        'Company fact 2: Google supports businesses and developers through Google Cloud, Workspace, Firebase, and related infrastructure offerings.',
        'Company fact 3: Google is investing heavily in AI across products and platforms, including Gemini and AI-powered experiences in Search, Workspace, and Cloud.',
        'Company fact 4: Google also plays a major role in digital advertising and web discovery through Search, Ads, and its broader ecosystem reach.',
        'Company fact 5: Google combines consumer scale, cloud infrastructure, mobile platforms, and AI research in a way that shapes much of the modern internet experience.',
      ];
    }

    return [
      `Company summary: ${company} appears to be an established company with products or services highlighted on its official website.`,
      `Company fact 1: ${company} presents itself as an organization with a public web presence and branded offerings.`,
    ];
  }

  private async rememberWorkflowCompanyFacts(context: ComplexTaskContext, snapshot: BrowserSnapshot): Promise<void> {
    const company = this.getRememberedFactValue(context, 'Company');
    if (!company || this.hasRememberedCompanyFacts(context)) {
      return;
    }

    if (['apple', 'google'].includes(company.toLowerCase())) {
      const rememberedFacts = this.buildFallbackCompanyFacts(company);
      context.workingMemory = this.mergeWorkingMemory(context.workingMemory, rememberedFacts);
      this.recordTaskHistory(context, `REMEMBERED: ${rememberedFacts.join(' ')}`);
      return;
    }

    const factAnswer = await geminiService.answerScreenQuestion({
      screenshot: snapshot.screenshot,
      question: `From only the current page, what does ${company} do? Give 4 or 5 short factual points I can reuse in an outreach email. Do not browse anywhere else.`,
      pageUrl: snapshot.pageUrl,
      pageTitle: snapshot.pageTitle,
      pageContext: snapshot.pageContext,
      sourceMode: snapshot.sourceMode,
      autoResearchEnabled: false,
    });

    const normalizedAnswer = this.normalizeLooseText(factAnswer.answer);
    const rememberedFacts = normalizedAnswer.includes("couldn't answer that clearly")
      ? this.buildFallbackCompanyFacts(company)
      : [
          `Company summary: ${factAnswer.answer.trim()}`,
          ...this.extractFactSentences(factAnswer.answer).map((fact, index) => `Company fact ${index + 1}: ${fact}`),
        ];

    context.workingMemory = this.mergeWorkingMemory(context.workingMemory, rememberedFacts);
    this.recordTaskHistory(context, `REMEMBERED: ${rememberedFacts.join(' ')}`);
  }

  private buildResearchToEmailComposeUrl(context: ComplexTaskContext): string {
    const recipientEmail = this.getRememberedFactValue(context, 'Recipient email') || '';
    const subject = this.buildOutreachDraftSubject(context);
    const body = this.buildOutreachDraftBody(context);
    return this.buildGmailComposeUrl(recipientEmail, { subject, body });
  }

  private buildGmailComposeUrl(
    recipientEmail?: string | null,
    options: { subject?: string | null; body?: string | null } = {},
  ): string {
    const composeUrl = new URL('https://mail.google.com/mail/u/0/');
    composeUrl.searchParams.set('fs', '1');
    composeUrl.searchParams.set('tf', 'cm');
    if (recipientEmail?.trim()) {
      composeUrl.searchParams.set('to', recipientEmail.trim());
    }
    if (options.subject?.trim()) {
      composeUrl.searchParams.set('su', options.subject.trim());
    }
    if (options.body?.trim()) {
      composeUrl.searchParams.set('body', options.body);
    }
    return composeUrl.toString();
  }

  private async runResearchToEmailWorkflow(context: ComplexTaskContext, runId: number): Promise<boolean> {
    if (!this.isResearchToEmailWorkflow(context) || !this.isRunCurrent(runId)) {
      return false;
    }

    const company = this.getRememberedFactValue(context, 'Company');
    const recipientEmail = this.getRememberedFactValue(context, 'Recipient email');
    if (!company || !recipientEmail) {
      return false;
    }

    const companySlug = this.slugifyLinkedInCompany(company);
    const linkedInUrl = `https://www.linkedin.com/company/${companySlug}/`;

    let tabs = browserService.listTabs();
    let linkedInTab = tabs.find((tab) => tab.url.toLowerCase().includes(`/company/${companySlug}/`)) || null;
    if (!linkedInTab) {
      const actionResult = await browserService.executeAction({ type: 'navigate', url: linkedInUrl });
      this.recordTaskHistory(context, this.describeAction({ type: 'navigate', url: linkedInUrl }, actionResult));
      await this.waitForSettle('navigate', runId);
      tabs = browserService.listTabs();
      linkedInTab = tabs.find((tab) => tab.url.toLowerCase().includes(`/company/${companySlug}/`)) || null;
    } else if (!linkedInTab.isActive) {
      const actionResult = await browserService.executeAction({ type: 'switch_tab', tabId: linkedInTab.id });
      this.recordTaskHistory(context, this.describeAction({ type: 'switch_tab', tabId: linkedInTab.id }, actionResult));
      await this.waitForSettle('switch_tab', runId);
    }

    let snapshot = await this.captureActiveBrowserSnapshot(runId);
    if (!snapshot) {
      return false;
    }

    let companySiteTab = this.findCompanySiteTab(snapshot, company);
    if (!companySiteTab) {
      const actionResult = await browserService.executeAction({ type: 'open_tab', url: `${company} official website` });
      this.recordTaskHistory(context, this.describeAction({ type: 'open_tab', url: `${company} official website` }, actionResult));
      await this.waitForSettle('open_tab', runId);
      snapshot = await this.captureActiveBrowserSnapshot(runId);
      if (!snapshot) {
        return false;
      }
      companySiteTab = this.findCompanySiteTab(snapshot, company);
    }

    if (companySiteTab && snapshot.activeTabId !== companySiteTab.id) {
      const actionResult = await browserService.executeAction({ type: 'switch_tab', tabId: companySiteTab.id });
      this.recordTaskHistory(context, this.describeAction({ type: 'switch_tab', tabId: companySiteTab.id }, actionResult));
      await this.waitForSettle('switch_tab', runId);
      snapshot = await this.captureActiveBrowserSnapshot(runId);
      if (!snapshot) {
        return false;
      }
    }

    await this.rememberWorkflowCompanyFacts(context, snapshot);

    tabs = browserService.listTabs();
    const gmailTab = tabs.find((tab) => tab.url.includes('mail.google.com')) || null;
    if (gmailTab && (!gmailTab.isActive || !snapshot.pageUrl.includes('mail.google.com'))) {
      const actionResult = await browserService.executeAction({ type: 'switch_tab', tabId: gmailTab.id });
      this.recordTaskHistory(context, this.describeAction({ type: 'switch_tab', tabId: gmailTab.id }, actionResult));
      await this.waitForSettle('switch_tab', runId);
    }

    const composeUrl = this.buildResearchToEmailComposeUrl(context);
    const composeResult = await browserService.executeAction({ type: 'navigate', url: composeUrl });
    this.recordTaskHistory(context, this.describeAction({ type: 'navigate', url: composeUrl }, composeResult));
    await this.waitForSettle('navigate', runId);

    const draft = await browserService.inspectGmailDraft();
    if (!draft || !draft.sendVisible) {
      return false;
    }

    const composeSnapshot = await this.captureActiveBrowserSnapshot(runId);
    if (!composeSnapshot) {
      return false;
    }

    this.syncResearchToEmailWorkflowSubtasks(context, composeSnapshot);
    const riskyAction = this.buildRiskyActionPrompt({ type: 'click', selector: 'Send' }, composeSnapshot)
      || {
        prompt: 'I am ready to send this email. Please say yes to confirm or no to cancel that step.',
        descriptor: 'send this email',
      };

    await this.promptPendingRiskyAction(
      { type: 'click', selector: 'Send' },
      riskyAction.prompt,
      riskyAction.descriptor,
      runId,
      context,
    );
    return true;
  }

  private async maybeHandleDeterministicWorkflowProgress(
    context: ComplexTaskContext,
    snapshot: BrowserSnapshot,
    runId: number,
  ): Promise<boolean> {
    if (!this.isRunCurrent(runId)) {
      return false;
    }

    const simpleOpenGoal = await this.resolveSimpleOpenGoal(context.goal);
    if (simpleOpenGoal && this.urlsMatchNavigationTarget(snapshot.pageUrl, simpleOpenGoal.url)) {
      this.recordTaskHistory(context, `COMPLETED: Opened ${simpleOpenGoal.target}.`);
      this.markCurrentSubtaskDone(context);
      return true;
    }

    const activeSubtask = this.normalizeLooseText(context.activeSubtask || context.goal);
    if (!activeSubtask) {
      return false;
    }

    const company = this.getRememberedFactValue(context, 'Company');
    const alreadyHasFacts = this.hasRememberedCompanyFacts(context);
    const activeUrl = snapshot.pageUrl.toLowerCase();
    const workflowCompanySite = company ? this.findCompanySiteTab(snapshot, company) : null;

    if (/\bremember\b.*\bkey facts\b|\bkey facts\b.*\bremember\b/i.test(activeSubtask) && alreadyHasFacts) {
      this.recordTaskHistory(context, 'COMPLETED: Remembered the key company facts for later steps.');
      this.markCurrentSubtaskDone(context);
      return true;
    }

    if (
      company
      && (
        /\bfigure out what\b.*\bdoes\b/i.test(activeSubtask)
        || (this.isResearchToEmailWorkflow(context) && !alreadyHasFacts && workflowCompanySite?.id === snapshot.activeTabId)
      )
      && !activeUrl.includes('mail.google.com')
      && !activeUrl.includes('google.com/search')
    ) {
      if (!alreadyHasFacts) {
        const factAnswer = await geminiService.answerScreenQuestion({
          screenshot: snapshot.screenshot,
          question: `From only the current page, what does ${company} do? Give 4 or 5 short factual points I can reuse in an outreach email. Do not browse anywhere else.`,
          pageUrl: snapshot.pageUrl,
          pageTitle: snapshot.pageTitle,
          pageContext: snapshot.pageContext,
          sourceMode: snapshot.sourceMode,
          autoResearchEnabled: false,
        });

        const rememberedFacts = [
          `Company summary: ${factAnswer.answer.trim()}`,
          ...this.extractFactSentences(factAnswer.answer).map((fact, index) => `Company fact ${index + 1}: ${fact}`),
        ];
        context.workingMemory = this.mergeWorkingMemory(context.workingMemory, rememberedFacts);
        this.recordTaskHistory(context, `REMEMBERED: ${factAnswer.answer.trim()}`);
      }

      this.markCurrentSubtaskDone(context);
      if (this.normalizeLooseText(context.activeSubtask || '').includes('remember') && this.hasRememberedCompanyFacts(context)) {
        this.recordTaskHistory(context, 'COMPLETED: Stored the company facts for the email step.');
        this.markCurrentSubtaskDone(context);
      }
      return true;
    }

    if (/\bgmail\b/i.test(activeSubtask) && activeUrl.includes('mail.google.com')) {
      this.recordTaskHistory(context, 'COMPLETED: Switched back to Gmail.');
      this.markCurrentSubtaskDone(context);
      return true;
    }

    return false;
  }

  private async getDeterministicWorkflowAction(
    context: ComplexTaskContext,
    snapshot: BrowserSnapshot,
  ): Promise<{ narration: string; action: GeminiAction } | null> {
    const activeSubtask = this.normalizeLooseText(context.activeSubtask || context.goal);
    if (!activeSubtask) {
      return null;
    }

    const company = this.getRememberedFactValue(context, 'Company');
    const recipientEmail = this.getRememberedFactValue(context, 'Recipient email');
    const gmailTab = snapshot.tabs.find((tab) => tab.url.includes('mail.google.com')) || null;
    const activeUrl = snapshot.pageUrl.toLowerCase();
    const companySiteTab = company ? this.findCompanySiteTab(snapshot, company) : null;
    const simpleOpenGoal = await this.resolveSimpleOpenGoal(context.goal);

    if (simpleOpenGoal) {
      const matchingTab = snapshot.tabs.find((tab) => this.urlsMatchNavigationTarget(tab.url, simpleOpenGoal.url)) || null;
      if (matchingTab && snapshot.activeTabId !== matchingTab.id) {
        return {
          narration: `I already have ${simpleOpenGoal.target} open, so I'll switch to that tab.`,
          action: { type: 'switch_tab', tabId: matchingTab.id },
        };
      }

      if (!this.urlsMatchNavigationTarget(snapshot.pageUrl, simpleOpenGoal.url)) {
        return {
          narration: `I'll open ${simpleOpenGoal.target} directly.`,
          action: { type: 'navigate', url: simpleOpenGoal.url },
        };
      }
    }

    if (company && recipientEmail && this.isResearchToEmailWorkflow(context)) {
      const slug = this.slugifyLinkedInCompany(company);
      const linkedInTab = slug
        ? snapshot.tabs.find((tab) => tab.url.toLowerCase().includes(`/company/${slug}/`)) || null
        : null;

      if (!linkedInTab && (!slug || !activeUrl.includes(`/company/${slug}/`))) {
        return {
          narration: `I'll open ${company}'s LinkedIn page directly.`,
          action: { type: 'navigate', url: `https://www.linkedin.com/company/${slug}/` },
        };
      }

      if (!companySiteTab) {
        return {
          narration: `I'll open ${company}'s official website in another tab.`,
          action: { type: 'open_tab', url: `${company} official website` },
        };
      }

      if (!this.hasRememberedCompanyFacts(context)) {
        if (snapshot.activeTabId !== companySiteTab.id) {
          return {
            narration: `I'll switch to ${company}'s website so I can gather the key facts.`,
            action: { type: 'switch_tab', tabId: companySiteTab.id },
          };
        }

        return null;
      }

      if (gmailTab && snapshot.activeTabId !== gmailTab.id) {
        return {
          narration: "I already have Gmail open, so I'll switch back to that tab.",
          action: { type: 'switch_tab', tabId: gmailTab.id },
        };
      }
    }

    if (company && /\b(official website|company website)\b/i.test(activeSubtask)) {
      const existingCompanySiteTab = companySiteTab;

      if (existingCompanySiteTab && snapshot.activeTabId !== existingCompanySiteTab.id) {
        return {
          narration: `I already have ${company}'s website open, so I'll switch to that tab.`,
          action: { type: 'switch_tab', tabId: existingCompanySiteTab.id },
        };
      }

      if (!existingCompanySiteTab) {
        return {
          narration: `I'll open ${company}'s official website in another tab.`,
          action: { type: 'open_tab', url: `${company} official website` },
        };
      }
    }

    if (company && /\blinkedin page\b/i.test(activeSubtask)) {
      const slug = this.slugifyLinkedInCompany(company);
      const targetUrl = slug ? `https://www.linkedin.com/company/${slug}/` : null;
      const existingLinkedInCompanyTab = targetUrl
        ? snapshot.tabs.find((tab) => tab.url.toLowerCase().includes(`/company/${slug}/`))
        : null;

      if (existingLinkedInCompanyTab && snapshot.activeTabId !== existingLinkedInCompanyTab.id) {
        return {
          narration: `I found ${company}'s LinkedIn tab, so I'll switch to it now.`,
          action: { type: 'switch_tab', tabId: existingLinkedInCompanyTab.id },
        };
      }

      if (targetUrl && !activeUrl.includes(`/company/${slug}/`)) {
        return {
          narration: `I'll open ${company}'s LinkedIn page directly.`,
          action: { type: 'navigate', url: targetUrl },
        };
      }
    }

    if ((/\bgmail\b/i.test(activeSubtask) || (recipientEmail && EMAIL_DRAFT_STEP_PATTERN.test(activeSubtask))) && gmailTab && snapshot.activeTabId !== gmailTab.id) {
      return {
        narration: 'I already have Gmail open, so I’ll switch back to that tab.',
        action: { type: 'switch_tab', tabId: gmailTab.id },
      };
    }

    if (recipientEmail && EMAIL_DRAFT_STEP_PATTERN.test(activeSubtask) && activeUrl.includes('mail.google.com')) {
      const draft = await browserService.inspectGmailDraft();
      const canPrefillOutreach = Boolean(company) && this.isResearchToEmailWorkflow(context);
      const subject = canPrefillOutreach ? this.buildOutreachDraftSubject(context) : null;
      const body = canPrefillOutreach ? this.buildOutreachDraftBody(context) : null;
      const normalizedBody = this.normalizeLooseText(draft?.bodyText || '');
      const normalizedCompany = this.normalizeLooseText(company || '');

      if (!draft?.composeOpen) {
        return {
          narration: canPrefillOutreach ? "I'll open a prefilled Gmail draft." : "I'll open Gmail compose and address the email.",
          action: { type: 'navigate', url: this.buildGmailComposeUrl(recipientEmail, { subject, body }) },
        };
      }

      if (!draft.toValue || !draft.toValue.toLowerCase().includes(recipientEmail.toLowerCase())) {
        return {
          narration: `I'll address the draft to ${recipientEmail}.`,
          action: { type: 'fill', selector: 'To recipients', value: recipientEmail },
        };
      }

      if (canPrefillOutreach && !(draft.subject || '').trim() && subject) {
        return {
          narration: "I'll add a subject line.",
          action: { type: 'fill', selector: 'Subject', value: subject },
        };
      }

      if (canPrefillOutreach && body && (normalizedBody.length < 60 || (normalizedCompany && !normalizedBody.includes(normalizedCompany)))) {
        return {
          narration: "I'll draft the outreach email using the facts I collected.",
          action: { type: 'fill', selector: 'Message Body', value: body },
        };
      }

      if (canPrefillOutreach && draft.sendVisible) {
        return {
          narration: "The draft is ready. I'll pause before sending it.",
          action: { type: 'click', selector: 'Send' },
        };
      }
    }

    return null;
  }

  private shouldSkipInitialBrowserBootstrap(goal: string): boolean {
    return this.looksLikeComplexBrowserWorkflow(goal);
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

  private normalizeBrowserRescueIntent(text: string): string | null {
    const normalized = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    return BROWSER_RESCUE_PATTERNS.some((pattern) => pattern.test(normalized))
      ? text.trim()
      : null;
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

    const isExplicitBrowserCommand = /^(open|go|search|click|press|scroll|navigate|fill|select|show|switch|draft|compose|visit|take me to|bring me to)\b/i.test(normalized);
    const hasWorkflowSignals = this.countPatternMatches(normalized, COMPLEX_BROWSER_ACTION_PATTERN) >= 2
      || this.countPatternMatches(normalized, COMPLEX_BROWSER_SEQUENCE_PATTERN) > 0;
    if (isExplicitBrowserCommand || hasWorkflowSignals) {
      return null;
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

    if (this.looksLikeComplexBrowserWorkflow(text)) {
      return true;
    }

    if (this.normalizeBrowserRescueIntent(normalized)) {
      return true;
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

    if (this.looksLikeComplexBrowserWorkflow(trimmed)) {
      return trimmed;
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
    if (this.pendingRiskyAction) {
      windowManager.broadcastToAll('sally:auto-confirmation-stop', undefined);
    }
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

  private fingerprintAction(action: GeminiAction): string {
    return JSON.stringify({
      type: action.type,
      selector: action.selector || null,
      value: action.value || null,
      url: action.url || null,
      index: typeof action.index === 'number' ? action.index : null,
      tabId: action.tabId || null,
      targetId: action.targetId || null,
    });
  }

  private recordRecentAction(context: ComplexTaskContext, action: GeminiAction, snapshot: BrowserSnapshot): void {
    context.recentActions.push({
      fingerprint: this.fingerprintAction(action),
      pageUrl: snapshot.pageUrl,
      pageTitle: snapshot.pageTitle,
    });
    if (context.recentActions.length > 6) {
      context.recentActions.splice(0, context.recentActions.length - 6);
    }
  }

  private isDuplicateActionOnSamePage(context: ComplexTaskContext, action: GeminiAction, snapshot: BrowserSnapshot): boolean {
    const fingerprint = this.fingerprintAction(action);
    return context.recentActions.some((entry) => (
      entry.fingerprint === fingerprint
      && entry.pageUrl === snapshot.pageUrl
      && entry.pageTitle === snapshot.pageTitle
    ));
  }

  private shouldSubmitRepeatedSearch(context: ComplexTaskContext, action: GeminiAction, snapshot: BrowserSnapshot): boolean {
    if (!['type', 'fill'].includes(action.type)) {
      return false;
    }

    if (!this.isDuplicateActionOnSamePage(context, action, snapshot)) {
      return false;
    }

    const searchHints = [
      action.selector,
      snapshot.pageContext.activeElement,
      context.activeSubtask,
      context.planSummary,
    ]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .join(' ');

    return /\b(search|find|look up|linkedin page|official website|company website)\b/i.test(searchHints);
  }

  private findMatchingSubtaskTitle(subtasks: GeminiTaskSubtask[], desiredTitle: string | null | undefined): string | null {
    const normalizedDesired = this.normalizeLooseText(desiredTitle || '');
    if (!normalizedDesired) {
      return null;
    }

    const exact = subtasks.find((subtask) => this.normalizeLooseText(subtask.title) === normalizedDesired);
    if (exact) {
      return exact.title;
    }

    const fuzzy = subtasks.find((subtask) => {
      const normalizedTitle = this.normalizeLooseText(subtask.title);
      return normalizedTitle.includes(normalizedDesired) || normalizedDesired.includes(normalizedTitle);
    });
    return fuzzy?.title || null;
  }

  private markCurrentSubtaskDone(context: ComplexTaskContext): void {
    const matchedActiveTitle = this.findMatchingSubtaskTitle(context.subtasks, context.activeSubtask)
      || context.subtasks.find((subtask) => subtask.status === 'active')?.title
      || null;
    if (!matchedActiveTitle) {
      return;
    }

    let nextActivated = false;
    context.subtasks = context.subtasks.map((subtask) => {
      if (subtask.title === matchedActiveTitle && (subtask.status === 'active' || subtask.status === 'pending')) {
        return { ...subtask, status: 'done' };
      }

      if (!nextActivated && subtask.status === 'pending') {
        nextActivated = true;
        return { ...subtask, status: 'active' };
      }

      return subtask;
    });

    context.activeSubtask = context.subtasks.find((subtask) => subtask.status === 'active')?.title || null;
  }

  private async maybeAdvanceSubtaskAfterAction(
    context: ComplexTaskContext,
    action: GeminiAction,
  ): Promise<boolean> {
    const activeSubtask = this.normalizeLooseText(context.activeSubtask || '');
    if (!activeSubtask) {
      return false;
    }

    const tabs = browserService.listTabs();
    const pageInfo = await this.getCurrentPageInfo();
    const company = this.getRememberedFactValue(context, 'Company');
    const companySlug = company ? this.slugifyLinkedInCompany(company) : '';
    const activeTab = tabs.find((tab) => tab.isActive) || null;
    const activeUrl = (activeTab?.url || pageInfo?.url || '').toLowerCase();

    if (
      /\b(official website|company website)\b/i.test(activeSubtask)
      && activeTab
      && !activeUrl.includes('linkedin.com')
      && !activeUrl.includes('mail.google.com')
      && !activeUrl.includes('google.com/search')
    ) {
      this.markCurrentSubtaskDone(context);
      return true;
    }

    if (
      companySlug
      && /\blinkedin page\b/i.test(activeSubtask)
      && activeUrl.includes(`/company/${companySlug}/`)
    ) {
      this.markCurrentSubtaskDone(context);
      return true;
    }

    if (
      /\bgmail\b/i.test(activeSubtask)
      && activeTab
      && activeUrl.includes('mail.google.com')
      && (action.type === 'switch_tab' || action.type === 'navigate')
    ) {
      this.markCurrentSubtaskDone(context);
      return true;
    }

    return false;
  }

  private createTaskContext(goal: string, runId: number): ComplexTaskContext {
    const trimmedGoal = goal.trim();
    const effectiveGoal = this.formatComplexBrowserWorkflow(trimmedGoal) || trimmedGoal;
    const seededMemory = this.extractSeedTaskMemory(trimmedGoal);
    const seededSubtasks = this.buildHeuristicSubtasks(trimmedGoal);
    return {
      goal: effectiveGoal,
      status: 'planning',
      planSummary: effectiveGoal,
      activeSubtask: seededSubtasks.find((subtask) => subtask.status === 'active')?.title || effectiveGoal,
      subtasks: seededSubtasks,
      workingMemory: this.mergeWorkingMemory(this.sessionWorkingMemory, seededMemory),
      history: [],
      failureCount: 0,
      lastFailure: null,
      totalActions: 0,
      actionsSincePlan: 0,
      startTime: Date.now(),
      activeTabId: null,
      completionNarration: null,
      currentRunId: runId,
      recentActions: [],
      autoRescueUsed: false,
    };
  }

  private persistTaskMemory(context: ComplexTaskContext | null): void {
    if (!context) {
      return;
    }

    this.sessionWorkingMemory = this.mergeWorkingMemory(context.workingMemory, this.sessionWorkingMemory);
  }

  private shouldKeepHeuristicSubtasks(goal: string, subtasks: GeminiTaskSubtask[]): boolean {
    if (!this.looksLikeComplexBrowserWorkflow(goal)) {
      return false;
    }

    if (subtasks.length >= 2) {
      return false;
    }

    const normalizedGoal = this.normalizeLooseText(goal);
    return subtasks.length === 0 || subtasks.every((subtask) => {
      const normalizedTitle = this.normalizeLooseText(subtask.title);
      return !normalizedTitle || normalizedTitle === normalizedGoal || normalizedTitle.length >= Math.max(24, Math.floor(normalizedGoal.length * 0.8));
    });
  }

  private applyTaskPlan(context: ComplexTaskContext, plan: GeminiTaskPlan): void {
    const heuristicSubtasks = this.buildHeuristicSubtasks(context.goal);
    const shouldUseHeuristics = this.shouldKeepHeuristicSubtasks(context.goal, plan.subtasks) && heuristicSubtasks.length > 1;
    const preserveExistingWorkflow = this.looksLikeComplexBrowserWorkflow(context.goal) && context.subtasks.length > 1;
    let nextSubtasks = preserveExistingWorkflow
      ? context.subtasks
      : shouldUseHeuristics
        ? heuristicSubtasks
      : (plan.subtasks.length > 0 ? plan.subtasks : context.subtasks);

    const plannerPreferredTitle = this.findMatchingSubtaskTitle(nextSubtasks, plan.activeSubtask)
      || this.findMatchingSubtaskTitle(nextSubtasks, plan.planSummary)
      || null;
    const desiredActiveTitle = plannerPreferredTitle
      || nextSubtasks.find((subtask) => subtask.status === 'active')?.title
      || nextSubtasks.find((subtask) => subtask.status === 'pending')?.title
      || context.activeSubtask;

    if (desiredActiveTitle) {
      let activeAssigned = false;
      nextSubtasks = nextSubtasks.map((subtask) => {
        if (subtask.status === 'done' || subtask.status === 'blocked') {
          return subtask;
        }

        if (!activeAssigned && subtask.title === desiredActiveTitle) {
          activeAssigned = true;
          return { ...subtask, status: 'active' };
        }

        return { ...subtask, status: 'pending' };
      });
    }

    context.planSummary = plan.planSummary || context.goal;
    context.activeSubtask = desiredActiveTitle || null;
    context.subtasks = nextSubtasks;
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

  private getActionSearchTexts(action: GeminiAction): string[] {
    const values = action.type === 'press'
      ? [action.selector, action.url]
      : [action.selector, action.value, action.url];

    return values
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim());
  }

  private isScopeMatch(expected: number[] | undefined, actual: number[]): boolean {
    if (!expected || expected.length === 0) {
      return true;
    }

    return expected.length === actual.length && expected.every((part, index) => part === actual[index]);
  }

  private scoreActionTargetMatch(action: GeminiAction, element: PageContextElement): number {
    if (action.targetId) {
      return element.targetId === action.targetId ? 240 : -1;
    }

    if (!this.isScopeMatch(action.framePath, element.framePath) || !this.isScopeMatch(action.shadowPath, element.shadowPath)) {
      return -1;
    }

    const queries = this.getActionSearchTexts(action);
    if (queries.length === 0) {
      return -1;
    }

    const haystacks = [element.label, element.text]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => this.normalizeLooseText(value));
    if (haystacks.length === 0) {
      return -1;
    }

    let score = -1;
    for (const query of queries) {
      const normalizedQuery = this.normalizeLooseText(query);
      if (!normalizedQuery) {
        continue;
      }

      for (const haystack of haystacks) {
        if (haystack === normalizedQuery) {
          score = Math.max(score, 180);
          continue;
        }

        if (haystack.startsWith(normalizedQuery) || normalizedQuery.startsWith(haystack)) {
          score = Math.max(score, 140);
          continue;
        }

        if (haystack.includes(normalizedQuery)) {
          score = Math.max(score, 100);
          continue;
        }

        const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
        const hitCount = queryTokens.filter((token) => haystack.includes(token)).length;
        if (hitCount > 0) {
          score = Math.max(score, 40 + hitCount * 15);
        }
      }
    }

    return score;
  }

  private findActionTargetMatch(
    action: GeminiAction,
    snapshot: BrowserSnapshot,
  ): { element: PageContextElement | null; score: number } {
    const elements = snapshot.pageContext.interactiveElements || [];
    if (elements.length === 0) {
      return { element: null, score: -1 };
    }

    if (action.targetId) {
      const exactMatch = elements.find((element) => element.targetId === action.targetId) || null;
      return {
        element: exactMatch,
        score: exactMatch ? 240 : -1,
      };
    }

    const match = elements
      .map((element) => ({ element, score: this.scoreActionTargetMatch(action, element) }))
      .filter((entry) => entry.score >= 80)
      .sort((left, right) => right.score - left.score || left.element.index - right.element.index)[0] || null;

    return {
      element: match?.element || null,
      score: match?.score ?? -1,
    };
  }

  private findActionTargetElement(action: GeminiAction, snapshot: BrowserSnapshot): PageContextElement | null {
    return this.findActionTargetMatch(action, snapshot).element;
  }

  private findActionDescriptor(action: GeminiAction, snapshot: BrowserSnapshot): string {
    if (action.type === 'open_tab' || action.type === 'switch_tab') {
      return action.selector || action.url || action.tabId || 'that tab';
    }

    const match = this.findActionTargetElement(action, snapshot);

    return match?.label || match?.text || match?.placeholder || action.selector || action.value || action.url || action.type;
  }

  private isHighlightableAction(action: GeminiAction): boolean {
    return ['click', 'fill', 'select', 'hover', 'focus', 'check', 'uncheck'].includes(action.type);
  }

  private async getActionTargetScreenBounds(
    action: GeminiAction,
    snapshot: BrowserSnapshot,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (!this.isHighlightableAction(action)) {
      return null;
    }

    const element = this.findActionTargetElement(action, snapshot);
    const contentBounds = await browserService.getBrowserContentBounds();
    if (!element || !contentBounds) {
      return null;
    }

    if (
      typeof element.left !== 'number'
      || typeof element.top !== 'number'
      || typeof element.width !== 'number'
      || typeof element.height !== 'number'
    ) {
      return null;
    }

    const padding = 8;
    return {
      x: contentBounds.x + element.left - padding,
      y: contentBounds.y + element.top - padding,
      width: Math.max(24, element.width + padding * 2),
      height: Math.max(24, element.height + padding * 2),
    };
  }

  private async showActionTargetHighlight(action: GeminiAction, snapshot: BrowserSnapshot): Promise<boolean> {
    const bounds = await this.getActionTargetScreenBounds(action, snapshot);
    if (!bounds) {
      windowManager.clearTargetHighlight();
      return false;
    }

    windowManager.showTargetHighlight(bounds, this.findActionDescriptor(action, snapshot));
    return true;
  }

  private async executeBrowserActionWithPreview(
    action: GeminiAction,
    snapshot: BrowserSnapshot,
    runId: number,
  ): Promise<string> {
    const showedHighlight = await this.showActionTargetHighlight(action, snapshot);
    if (showedHighlight && this.isRunCurrent(runId)) {
      await new Promise((resolve) => setTimeout(resolve, ACTION_TARGET_PREVIEW_MS));
    }

    if (!this.isRunCurrent(runId)) {
      return 'Action failed: run interrupted';
    }

    return browserService.executeAction(action);
  }

  private buildRiskyActionPrompt(action: GeminiAction, snapshot: BrowserSnapshot): { prompt: string; descriptor: string } | null {
    if (!['click', 'press', 'select', 'check', 'uncheck'].includes(action.type)) {
      return null;
    }

    if (
      action.type === 'press'
      && ![action.selector, action.value, action.url].some((value) => typeof value === 'string' && RISKY_ACTION_PATTERN.test(value))
    ) {
      return null;
    }

    const match = this.findActionTargetMatch(action, snapshot);
    const target = match.element;
    const descriptor = target?.label || target?.text || this.findActionDescriptor(action, snapshot);
    if (this.isSafeDraftSetupAction(action, descriptor)) {
      return null;
    }

    const riskyTexts = [
      action.selector,
      action.value,
    ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));

    if (action.targetId || match.score >= 140) {
      riskyTexts.push(...[
        descriptor,
        target?.label,
        target?.text,
      ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())));
    }

    if (!riskyTexts.some((value) => RISKY_ACTION_PATTERN.test(value))) {
      return null;
    }

    const prompt = `I am ready to ${descriptor}. Please say yes to confirm or no to cancel that step.`;
    return { prompt, descriptor };
  }

  private isSafeDraftSetupAction(action: GeminiAction, descriptor: string | null): boolean {
    if (!['click', 'press', 'select'].includes(action.type)) {
      return false;
    }

    const texts = [
      action.selector,
      action.value,
      descriptor,
    ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));

    return texts.some((value) => SAFE_DRAFT_ACTION_PATTERN.test(value))
      && !texts.some((value) => RISKY_ACTION_PATTERN.test(value));
  }

  private async promptPendingRiskyAction(
    action: GeminiAction,
    prompt: string,
    descriptor: string,
    runId: number,
    context?: ComplexTaskContext | null,
  ): Promise<void> {
    this.pendingRiskyAction = {
      action,
      prompt,
      descriptor,
      autoListenAttempts: 0,
    };

    if (context) {
      context.status = 'awaiting_confirmation';
      this.persistTaskMemory(context);
    } else if (this.currentTask) {
      this.currentTask.status = 'awaiting_confirmation';
    }

    this.broadcastChat('assistant', prompt);
    this.setState('awaiting_response');
    await ttsService.speakImmediate(prompt);
    if (!this.isRunCurrent(runId) || !this.pendingRiskyAction) {
      return;
    }

    this.setState('awaiting_response');
    this.startAutoConfirmationListen();
  }

  private startAutoConfirmationListen(): void {
    if (!this.pendingRiskyAction) {
      return;
    }

    windowManager.broadcastToAll('sally:auto-confirmation-listen', {
      maxDurationMs: AUTO_CONFIRMATION_MAX_DURATION_MS,
      trailingSilenceMs: AUTO_CONFIRMATION_TRAILING_SILENCE_MS,
    });
  }

  private async handlePendingRiskyActionMiss(runId: number): Promise<void> {
    if (!this.pendingRiskyAction || !this.currentTask) {
      return;
    }

    if (this.pendingRiskyAction.autoListenAttempts < 1) {
      this.pendingRiskyAction.autoListenAttempts += 1;
      this.currentTask.status = 'awaiting_confirmation';
      this.broadcastChat('assistant', 'Please say yes to confirm or no to cancel.');
      this.setState('awaiting_response');
      await ttsService.speakImmediate('Please say yes to confirm or no to cancel.');
      if (!this.isRunCurrent(runId) || !this.pendingRiskyAction) {
        return;
      }

      this.setState('awaiting_response');
      this.startAutoConfirmationListen();
      return;
    }

    this.currentTask.status = 'awaiting_confirmation';
    if (this.isRunCurrent(runId)) {
      this.setState('awaiting_response');
    }
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
      windowManager.clearTargetHighlight();
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

      const confirmationSnapshot = await this.captureActiveBrowserSnapshot(runId);
      const actionResult = confirmationSnapshot
        ? await this.executeBrowserActionWithPreview(pending.action, confirmationSnapshot, runId)
        : await browserService.executeAction(pending.action);
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
        this.currentTask.autoRescueUsed = false;
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
      windowManager.clearTargetHighlight();
      await this.runPlannedBrowserTask(this.currentTask, runId, {
        skipIntro: true,
        forcePlanReason: 'risky_action_confirmed',
      });
      return true;
    }

    await this.handlePendingRiskyActionMiss(runId);
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

    if (this.looksLikeComplexBrowserWorkflow(trimmed)) {
      return {
        intent: 'browser_task',
        confidence: 'high',
        normalizedInstruction: trimmed,
        spokenResponse: null,
        clarificationQuestion: null,
        browserAssistiveIntent: null,
      };
    }

    if (this.normalizeBrowserRescueIntent(trimmed)) {
      return {
        intent: 'browser_rescue',
        confidence: 'high',
        normalizedInstruction: trimmed,
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

    if (this.looksLikeComplexBrowserWorkflow(trimmed)) {
      if (interpretation.intent === 'browser_task') {
        return {
          ...interpretation,
          confidence: 'high',
          normalizedInstruction: interpretation.normalizedInstruction || trimmed,
          spokenResponse: null,
          clarificationQuestion: null,
        };
      }

      return this.buildForcedInterpretation('browser_task', trimmed);
    }

    const browserRescueIntent = this.normalizeBrowserRescueIntent(trimmed);
    if (browserRescueIntent) {
      return interpretation.intent === 'browser_rescue'
        ? {
            ...interpretation,
            confidence: 'high',
            normalizedInstruction: interpretation.normalizedInstruction || browserRescueIntent,
            spokenResponse: null,
            clarificationQuestion: null,
          }
        : this.buildForcedInterpretation('browser_rescue', browserRescueIntent);
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

  private serializeLoggingError(error: unknown): Record<string, string | null> {
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

    if (this.shouldSkipInitialBrowserBootstrap(trimmed)) {
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

    const simpleOpenGoal = await this.resolveSimpleOpenGoal(trimmed);
    if (simpleOpenGoal) {
      console.log('[SessionManager] Resolved destination:', simpleOpenGoal.target, '->', simpleOpenGoal.url);
      return simpleOpenGoal.url;
    }

    const searchLike = trimmed.match(/^(?:search(?: for)?|find|look up|lookup|research)\s+(.+)$/i);
    if (searchLike?.[1]) {
      return destinationResolver.buildSearchUrl(searchLike[1].trim());
    }

    return null;
  }

  private extractSimpleOpenTarget(text: string): string | null {
    if (this.looksLikeComplexBrowserWorkflow(text)) {
      return null;
    }

    const openLike = text.trim().match(/^(?:open|go to|navigate to|visit|take me to|bring me to)\s+(.+)$/i);
    if (!openLike?.[1]) {
      return null;
    }

    return openLike[1].trim() || null;
  }

  private async resolveSimpleOpenGoal(text: string): Promise<{ target: string; url: string } | null> {
    const target = this.extractSimpleOpenTarget(text);
    if (!target) {
      return null;
    }

    const resolved = await destinationResolver.resolveNavigationTarget(target);
    if (resolved.via === 'search') {
      return null;
    }

    return {
      target,
      url: resolved.url,
    };
  }

  private async handleSimpleDirectOpen(
    goal: { target: string; url: string },
    runId: number,
  ): Promise<boolean> {
    if (!this.isRunCurrent(runId)) {
      return false;
    }

    this.setState('acting');
    const existingTab = browserService.listTabs().find((tab) => this.urlsMatchNavigationTarget(tab.url, goal.url)) || null;
    const action: GeminiAction = existingTab
      ? { type: 'switch_tab', tabId: existingTab.id }
      : { type: 'navigate', url: goal.url };

    await browserService.executeAction(action);
    if (!this.isRunCurrent(runId)) {
      return false;
    }

    await this.waitForSettle(action.type, runId);
    await this.syncOverlayTargetFromBrowser(runId);

    const activeTab = browserService.listTabs().find((tab) => tab.isActive) || null;
    const finalUrl = activeTab?.url || (await this.getCurrentPageInfo())?.url || '';
    const succeeded = Boolean(finalUrl) && this.urlsMatchNavigationTarget(finalUrl, goal.url);
    if (!succeeded) {
      return false;
    }

    const response = existingTab
      ? `Switched to ${goal.target}.`
      : `Opened ${goal.target}.`;
    this.broadcastChat('assistant', response);
    await ttsService.speakImmediate(response);
    if (this.isRunCurrent(runId)) {
      this.setState('idle');
    }
    return true;
  }

  private urlsMatchNavigationTarget(currentUrl: string, targetUrl: string): boolean {
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (current.origin !== target.origin) {
        if (target.hostname === 'mail.google.com') {
          if (current.hostname === 'workspace.google.com' && /\/gmail\/?$/i.test(current.pathname.replace(/\/+$/g, ''))) {
            return true;
          }

          if (current.hostname === 'accounts.google.com') {
            const continueTarget = current.searchParams.get('continue') || '';
            const service = current.searchParams.get('service') || '';
            return continueTarget.includes('mail.google.com') || /mail/i.test(service);
          }
        }

        return false;
      }

      const normalizedTargetPath = target.pathname.replace(/\/+$/g, '') || '/';
      const normalizedCurrentPath = current.pathname.replace(/\/+$/g, '') || '/';
      if (normalizedTargetPath === '/') {
        return true;
      }

      return normalizedCurrentPath === normalizedTargetPath || normalizedCurrentPath.startsWith(`${normalizedTargetPath}/`);
    } catch {
      return currentUrl === targetUrl || currentUrl.startsWith(targetUrl);
    }
  }

  async handleTranscription(audioBase64: string, mimeType: string, durationMs?: number): Promise<string> {
    const runId = this.startRun();
    this.setState('processing');
    cloudLog('INFO', 'session_start', {
      source: 'voice',
      runId,
      mimeType,
      durationMs: durationMs ?? null,
    });

    try {
      if (!this.isRunCurrent(runId)) {
        return '';
      }

      if (!apiKeyManager.hasGeminiApiKey()) {
        if (!this.isRunCurrent(runId)) {
          return '';
        }
        ttsService.speakImmediate('Please configure a Gemini API key in settings for speech transcription.');
        if (this.isRunCurrent(runId)) {
          this.setState('idle');
        }
        return '';
      }

      const transcription = await transcriptionService.transcribe(audioBase64, mimeType, { durationMs });
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
    cloudLog('INFO', 'session_start', {
      source: 'typed',
      runId,
      textLength: text.trim().length,
    });
    await this.executeTaskForRun(text, runId, 'typed');
  }

  async handleSilence(details?: { durationMs?: number; peakLevel?: number; averageLevel?: number; mode?: 'default' | 'confirmation' }): Promise<void> {
    const runId = this.startRun();
    this.setState('processing');

    console.log('[SessionManager] Ignoring silent voice input:', {
      durationMs: details?.durationMs ?? 0,
      peakLevel: details?.peakLevel ?? 0,
      averageLevel: details?.averageLevel ?? 0,
      mode: details?.mode ?? 'default',
    });

    if (!this.isRunCurrent(runId)) {
      return;
    }

    if (details?.mode === 'confirmation' && this.pendingRiskyAction && this.currentTask) {
      await this.handlePendingRiskyActionMiss(runId);
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
    let sessionEndStatus = 'completed';
    let interpretedIntent: GeminiUserRequestIntent | null = null;
    const sessionEndMetadata: Record<string, unknown> = {
      runId,
      source,
      textLength: trimmed.length,
    };

    try {
      if (!trimmed) {
        sessionEndStatus = 'empty_input';
        if (this.isRunCurrent(runId)) {
          ttsService.speakImmediate("I didn't catch that clearly. Please say it again.");
          this.setState('idle');
        }
        return '';
      }

      this.broadcastChat('user', trimmed);

      if (await this.handlePendingRiskyActionResponse(trimmed, runId)) {
        sessionEndStatus = this.state === 'awaiting_response' ? 'awaiting_response' : 'completed';
        sessionEndMetadata.pendingRiskyActionResponse = true;
        return trimmed;
      }

      const interpretation = await this.interpretUserRequest(trimmed, source);
      if (!this.isRunCurrent(runId)) {
        sessionEndStatus = 'interrupted';
        return trimmed;
      }

      interpretedIntent = interpretation.intent;
      this.logInterpretation(trimmed, interpretation);
      cloudLog('INFO', 'intent_classification', {
        runId,
        source,
        intent: interpretation.intent,
        confidence: interpretation.confidence,
        normalizedInstruction: interpretation.normalizedInstruction,
        browserAssistiveIntent: interpretation.browserAssistiveIntent,
        clarificationQuestion: interpretation.clarificationQuestion,
        hasSpokenResponse: Boolean(interpretation.spokenResponse),
      });

      switch (interpretation.intent) {
        case 'cancel':
          sessionEndStatus = 'cancelled';
          this.clearPendingClarification();
          this.clearPendingRiskyAction();
          await this.cancel();
          return 'cancel';

        case 'describe_screen':
          sessionEndStatus = 'completed';
          this.clearPendingClarification();
          this.addRecentTurn({
            user: trimmed,
            intent: interpretation.intent,
            normalizedInstruction: interpretation.normalizedInstruction,
          });
          await this.describeScreen(runId);
          return interpretation.normalizedInstruction || trimmed;

        case 'summarize_screen':
          sessionEndStatus = 'completed';
          this.clearPendingClarification();
          this.addRecentTurn({
            user: trimmed,
            intent: interpretation.intent,
            normalizedInstruction: interpretation.normalizedInstruction,
          });
          await this.summarizeScreen(runId);
          return interpretation.normalizedInstruction || trimmed;

        case 'screen_question':
          sessionEndStatus = 'completed';
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
          sessionEndStatus = this.state === 'awaiting_response' ? 'awaiting_response' : 'completed';
          return interpretation.normalizedInstruction || trimmed;
        }

        case 'browser_rescue': {
          this.clearPendingClarification();
          this.addRecentTurn({
            user: trimmed,
            intent: interpretation.intent,
            normalizedInstruction: interpretation.normalizedInstruction,
          });
          await this.handleBrowserRescue(runId, 'manual');
          sessionEndStatus = this.state === 'awaiting_response' ? 'awaiting_response' : 'completed';
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
          const taskContext = this.createTaskContext(expanded, runId);
          this.currentTask = taskContext;
          sessionEndMetadata.taskGoal = expanded;
          await this.runPlannedBrowserTask(taskContext, runId);
          sessionEndStatus = taskContext.status || (this.state === 'awaiting_response' ? 'awaiting_response' : 'completed');
          sessionEndMetadata.taskStatus = taskContext.status || null;
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
          const simpleOpenGoal = await this.resolveSimpleOpenGoal(normalizedInstruction);
          if (simpleOpenGoal && await this.handleSimpleDirectOpen(simpleOpenGoal, runId)) {
            sessionEndStatus = 'completed';
            sessionEndMetadata.taskStatus = 'simple_direct_open';
            sessionEndMetadata.taskGoal = normalizedInstruction;
            return normalizedInstruction;
          }
          const taskContext = this.createTaskContext(normalizedInstruction, runId);
          this.currentTask = taskContext;
          sessionEndMetadata.taskGoal = normalizedInstruction;
          await this.runPlannedBrowserTask(taskContext, runId);
          sessionEndStatus = taskContext.status || (this.state === 'awaiting_response' ? 'awaiting_response' : 'completed');
          sessionEndMetadata.taskStatus = taskContext.status || null;
          return normalizedInstruction;
        }

        case 'chat': {
          sessionEndStatus = 'completed';
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
          sessionEndStatus = 'awaiting_response';
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
          sessionEndStatus = 'ignored';
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
    } catch (error) {
      sessionEndStatus = 'failed';
      sessionEndMetadata.error = this.serializeLoggingError(error);
      throw error;
    } finally {
      if (sessionEndStatus !== 'interrupted') {
        cloudLog(sessionEndStatus === 'failed' ? 'ERROR' : 'INFO', 'session_end', {
          ...sessionEndMetadata,
          intent: interpretedIntent,
          status: sessionEndStatus,
          state: this.state,
          currentTaskStatus: this.currentTask?.status || null,
          currentTaskGoal: this.currentTask?.goal || null,
        });
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
      if (!apiKeyManager.hasGeminiApiKey()) {
        return '';
      }

      const transcription = await transcriptionService.transcribe(audioBase64, mimeType, { durationMs, isPreview: true });
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

  private buildFallbackBrowserRescueAnalysis(snapshot: BrowserSnapshot): BrowserRescueAnalysis {
    const pageName = snapshot.pageTitle || snapshot.pageUrl || 'this page';
    const dialogs = snapshot.pageContext.dialogs.slice(0, 2);
    const errors = snapshot.pageContext.visibleMessages.slice(0, 3);
    const fields = snapshot.pageContext.interactiveElements
      .filter((element) => ['textbox', 'searchbox', 'combobox'].includes(element.role) && !element.disabled)
      .slice(0, 3);
    const safeButtons = snapshot.pageContext.interactiveElements
      .filter((element) => ['button', 'tab', 'menuitem'].includes(element.role))
      .filter((element) => {
        const descriptor = this.normalizeLooseText(element.label || element.text || '');
        return Boolean(descriptor) && !RISKY_ACTION_PATTERN.test(descriptor);
      })
      .slice(0, 4);
    const blockers = [
      ...dialogs.map((dialog) => ({
        label: dialog,
        reason: `Dialog open: ${dialog}`,
      })),
      ...errors.map((error) => ({
        label: error,
        reason: `Visible message: ${error}`,
      })),
    ].slice(0, 3);

    const suggestions: BrowserRescueSuggestion[] = [];
    const dismissButton = safeButtons.find((button) => {
      const descriptor = this.normalizeLooseText(button.label || button.text || '');
      return /\b(close|dismiss|not now|cancel|ok|continue)\b/i.test(descriptor);
    });
    if (dismissButton) {
      suggestions.push({
        label: `Close "${dismissButton.label || dismissButton.text}"`,
        reason: 'A dialog or interrupting control appears to be blocking progress.',
        action: {
          type: 'click',
          selector: dismissButton.label || dismissButton.text || 'Close',
          targetId: dismissButton.targetId,
          framePath: dismissButton.framePath,
          shadowPath: dismissButton.shadowPath,
        },
        safeToAutoExecute: true,
      });
    }

    if (fields.length > 0) {
      const firstField = fields[0];
      suggestions.push({
        label: `Focus "${firstField.label || firstField.placeholder || firstField.text || 'the next field'}"`,
        reason: 'The next likely step is entering information into a visible field.',
        action: {
          type: 'focus',
          selector: firstField.label || firstField.placeholder || firstField.text || 'field',
          targetId: firstField.targetId,
          framePath: firstField.framePath,
          shadowPath: firstField.shadowPath,
        },
        safeToAutoExecute: true,
      });
    }

    if (suggestions.length === 0 && safeButtons.length > 0) {
      const firstButton = safeButtons[0];
      suggestions.push({
        label: `Use "${firstButton.label || firstButton.text || 'the next button'}"`,
        reason: 'This looks like the next visible control that can move the workflow forward.',
        action: {
          type: 'click',
          selector: firstButton.label || firstButton.text || 'button',
          targetId: firstButton.targetId,
          framePath: firstButton.framePath,
          shadowPath: firstButton.shadowPath,
        },
        safeToAutoExecute: true,
      });
    }

    return {
      pageSummary: snapshot.pageContext.semanticSummary || `I can see ${pageName}.`,
      blockers,
      suggestions,
    };
  }

  private async analyzeBrowserRescue(
    snapshot: BrowserSnapshot,
    context: ComplexTaskContext | null,
  ): Promise<BrowserRescueAnalysis> {
    const rescueAnalyzer = (geminiService as typeof geminiService & {
      analyzeBrowserRescue?: (params: {
        screenshot: string;
        pageUrl?: string;
        pageTitle?: string;
        pageContext?: BrowserSnapshot['pageContext'];
        sourceMode?: BrowserSnapshot['sourceMode'];
        tabs?: BrowserSnapshot['tabs'];
        activeTabId?: string | null;
        overallGoal?: string | null;
        failureContext?: string | null;
        history?: string[];
      }) => Promise<BrowserRescueAnalysis>;
    }).analyzeBrowserRescue?.bind(geminiService);

    if (!rescueAnalyzer) {
      return this.buildFallbackBrowserRescueAnalysis(snapshot);
    }

    try {
      const analysis = await rescueAnalyzer({
        screenshot: snapshot.screenshot,
        pageUrl: snapshot.pageUrl,
        pageTitle: snapshot.pageTitle,
        pageContext: snapshot.pageContext,
        sourceMode: snapshot.sourceMode,
        tabs: snapshot.tabs,
        activeTabId: snapshot.activeTabId,
        overallGoal: context?.goal || null,
        failureContext: context?.lastFailure || null,
        history: context?.history || [],
      });

      const fallback = this.buildFallbackBrowserRescueAnalysis(snapshot);
      if (!analysis?.pageSummary) {
        return this.buildFallbackBrowserRescueAnalysis(snapshot);
      }

      const hasExecutableSuggestion = analysis.suggestions.some((suggestion) => Boolean(suggestion.action));

      return {
        pageSummary: analysis.pageSummary || fallback.pageSummary,
        blockers: analysis.blockers.length > 0 ? analysis.blockers : fallback.blockers,
        suggestions: hasExecutableSuggestion ? analysis.suggestions : fallback.suggestions,
      };
    } catch (error) {
      console.warn('[SessionManager] Rescue analysis failed, using fallback:', error);
      return this.buildFallbackBrowserRescueAnalysis(snapshot);
    }
  }

  private buildBrowserRescueNarration(analysis: BrowserRescueAnalysis, autoSuggestion: BrowserRescueSuggestion | null): string {
    const shorten = (value: string, maxLength = 110): string => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) {
        return '';
      }

      if (normalized.length <= maxLength) {
        return normalized.replace(/[.]+$/g, '');
      }

      return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '').replace(/[.,;:!?-]+$/g, '')}...`;
    };

    const lines: string[] = [];
    const summary = shorten(analysis.pageSummary);
    const blocker = analysis.blockers.length > 0
      ? shorten(analysis.blockers[0].reason, 96)
      : '';
    const nextStep = autoSuggestion
      ? `Next: ${shorten(autoSuggestion.label, 84)}.`
      : analysis.suggestions.length > 0
        ? `Next: ${shorten(analysis.suggestions[0].label, 84)}.`
        : '';

    if (summary) {
      lines.push(summary.endsWith('.') ? summary : `${summary}.`);
    }

    if (blocker) {
      lines.push(`Blocker: ${blocker.endsWith('.') ? blocker : `${blocker}.`}`);
    }

    if (nextStep) {
      lines.push(nextStep);
    }

    return lines.slice(0, 3).join('\n') || 'I can inspect this page and help with the next step.';
  }

  private async handleBrowserRescue(runId: number, trigger: 'manual' | 'automatic'): Promise<boolean> {
    if (!this.isRunCurrent(runId)) {
      return false;
    }

    if (!browserService.isRunning()) {
      const response = 'Open a page with Sally first, then I can inspect where you are stuck.';
      this.broadcastChat('assistant', response);
      await ttsService.speakImmediate(response);
      if (this.isRunCurrent(runId)) {
        this.setState('idle');
      }
      return false;
    }

    this.setState('acting');
    await this.syncOverlayTargetFromBrowser(runId);
    const snapshot = await this.captureActiveBrowserSnapshot(runId);
    if (!snapshot || !this.isRunCurrent(runId)) {
      return false;
    }

    const analysis = await this.analyzeBrowserRescue(snapshot, this.currentTask);
    const autoSuggestion = analysis.suggestions.find((suggestion) => (
      suggestion.safeToAutoExecute
      && suggestion.action
      && !this.buildRiskyActionPrompt(suggestion.action, snapshot)
    )) || null;
    const narration = this.buildBrowserRescueNarration(analysis, autoSuggestion);
    this.broadcastChat('assistant', narration);
    await ttsService.speakImmediate(narration);

    if (!this.isRunCurrent(runId)) {
      return false;
    }

    if (!autoSuggestion?.action) {
      if (trigger === 'manual') {
        this.setState('idle');
      }
      return false;
    }

    const riskyPrompt = this.buildRiskyActionPrompt(autoSuggestion.action, snapshot);
    if (riskyPrompt) {
      await this.showActionTargetHighlight(autoSuggestion.action, snapshot);
      await this.promptPendingRiskyAction(
        autoSuggestion.action,
        riskyPrompt.prompt,
        riskyPrompt.descriptor,
        runId,
        this.currentTask,
      );
      return true;
    }

    if (this.currentTask) {
      this.currentTask.status = 'executing';
    }

    const actionResult = await this.executeBrowserActionWithPreview(autoSuggestion.action, snapshot, runId);
    if (!this.isRunCurrent(runId)) {
      return true;
    }

    const succeeded = this.didActionSucceed(actionResult);
    windowManager.broadcastToAll('sally:step', {
      action: autoSuggestion.action.type,
      details: actionResult,
      timestamp: Date.now(),
    });

    if (this.currentTask) {
      const actionDesc = this.describeAction(autoSuggestion.action, actionResult);
      this.recordTaskHistory(this.currentTask, succeeded ? `RESCUE: ${actionDesc}` : `FAILED RESCUE: ${actionDesc}`);
      if (succeeded) {
        this.currentTask.failureCount = 0;
        this.currentTask.lastFailure = null;
        this.currentTask.totalActions += 1;
        this.currentTask.actionsSincePlan += 1;
        this.currentTask.autoRescueUsed = false;
      } else {
        this.currentTask.failureCount += 1;
        this.currentTask.lastFailure = actionResult;
        this.currentTask.autoRescueUsed = true;
      }
    }

    await this.waitForSettle(autoSuggestion.action.type, runId);
    windowManager.clearTargetHighlight();

    if (this.currentTask && trigger === 'manual' && succeeded) {
      await this.runPlannedBrowserTask(this.currentTask, runId, {
        skipIntro: true,
        forcePlanReason: 'manual_rescue',
      });
      return true;
    }

    if (trigger === 'manual' && this.isRunCurrent(runId)) {
      this.setState('idle');
    }
    return succeeded;
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
          cloudLog('WARNING', 'task_failed', {
            runId,
            goal: instruction,
            status: 'timeout',
            durationMs: Date.now() - startTime,
            historyLength: history.length,
          });
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
          cloudLog('INFO', 'task_completed', {
            runId,
            goal: instruction,
            durationMs: Date.now() - startTime,
            historyLength: history.length,
          });
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
      cloudLog('ERROR', 'task_failed', {
        runId,
        goal: instruction,
        status: 'exception',
        durationMs: Date.now() - startTime,
        error: this.serializeLoggingError(error),
      });
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

      if (await this.runResearchToEmailWorkflow(context, runId)) {
        return;
      }

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (!this.isRunCurrent(runId)) {
          return;
        }

        if (Date.now() - context.startTime > MAX_DURATION_MS) {
          context.status = 'failed';
          cloudLog('WARNING', 'task_failed', {
            runId,
            goal: context.goal,
            status: 'timeout',
            durationMs: Date.now() - context.startTime,
            totalActions: context.totalActions,
            failureCount: context.failureCount,
          });
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
        this.syncResearchToEmailWorkflowSubtasks(context, snapshot);

        if (context.failureCount >= REPLAN_FAILURE_THRESHOLD && !context.autoRescueUsed) {
          context.autoRescueUsed = true;
          const rescued = await this.handleBrowserRescue(runId, 'automatic');
          if (!this.isRunCurrent(runId)) {
            return;
          }
          if (rescued) {
            forcePlanReason = 'auto_rescue';
            continue;
          }
        }

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
              cloudLog('WARNING', 'task_failed', {
                runId,
                goal: context.goal,
                status: 'blocked',
                blockedReason: response,
                planSummary: context.planSummary,
                activeSubtask: context.activeSubtask,
                durationMs: Date.now() - context.startTime,
                totalActions: context.totalActions,
                failureCount: context.failureCount,
              });
              this.broadcastChat('assistant', response);
              await ttsService.speakImmediate(response);
              break;
            }

            if (plan.status === 'complete') {
              context.status = 'completed';
              const response = plan.completionNarration || 'That task is complete.';
              cloudLog('INFO', 'task_completed', {
                runId,
                goal: context.goal,
                planSummary: context.planSummary,
                activeSubtask: context.activeSubtask,
                durationMs: Date.now() - context.startTime,
                totalActions: context.totalActions,
                rememberedFacts: context.workingMemory.length,
              });
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

        const completedWorkflowStep = await this.maybeHandleDeterministicWorkflowProgress(context, snapshot, runId);
        if (completedWorkflowStep) {
          forcePlanReason = 'subtask_complete';
          continue;
        }

        let result: import('../services/geminiService.js').GeminiInterpretResult;
        const deterministicAction = await this.getDeterministicWorkflowAction(context, snapshot);
        if (deterministicAction) {
          result = deterministicAction;
        } else {
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
        }

        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Gemini result:', result.narration, result.action);

        if (result.narration) {
          this.broadcastChat('assistant', result.narration);
          ttsService.speak(result.narration);
        }

        if (!result.action || result.action.type === 'null') {
          this.recordTaskHistory(context, `COMPLETED: ${this.describeTaskStep(context)}`);
          this.markCurrentSubtaskDone(context);
          forcePlanReason = 'subtask_complete';
          continue;
        }

        let actionToExecute = result.action;
        if (this.shouldSubmitRepeatedSearch(context, actionToExecute, snapshot)) {
          actionToExecute = { type: 'press', value: 'Enter' };
          this.recordTaskHistory(context, 'ADAPTED: Submitted the current search instead of repeating the same typing action.');
        } else if (this.isDuplicateActionOnSamePage(context, actionToExecute, snapshot)) {
          context.failureCount += 1;
          context.lastFailure = 'Prevented a duplicate action on the same page';
          this.recordTaskHistory(context, `FAILED: Prevented duplicate action "${actionToExecute.type}" on the same page.`);
          forcePlanReason = 'duplicate_action_blocked';
          continue;
        }

        const riskyAction = this.buildRiskyActionPrompt(actionToExecute, snapshot);
        if (riskyAction) {
          await this.showActionTargetHighlight(actionToExecute, snapshot);
          await this.promptPendingRiskyAction(
            actionToExecute,
            riskyAction.prompt,
            riskyAction.descriptor,
            runId,
            context,
          );
          return;
        }

        const actionResult = await this.executeBrowserActionWithPreview(actionToExecute, snapshot, runId);
        if (!this.isRunCurrent(runId)) return;
        console.log('[SessionManager] Action result:', actionResult);

        const succeeded = this.didActionSucceed(actionResult);
        const actionDesc = this.describeAction(actionToExecute, actionResult);
        this.recordTaskHistory(context, succeeded ? actionDesc : `FAILED: ${actionDesc}`);
        this.recordRecentAction(context, actionToExecute, snapshot);
        if (succeeded) {
          context.failureCount = 0;
          context.lastFailure = null;
          context.totalActions += 1;
          context.actionsSincePlan += 1;
          context.autoRescueUsed = false;
        } else {
          context.failureCount += 1;
          context.lastFailure = actionResult;
        }

        windowManager.broadcastToAll('sally:step', {
          action: actionToExecute.type,
          details: actionResult,
          timestamp: Date.now(),
        });

        await this.waitForSettle(actionToExecute.type, runId);
        windowManager.clearTargetHighlight();
        await this.syncOverlayTargetFromBrowser(runId);

        const completedSubtask = succeeded
          ? await this.maybeAdvanceSubtaskAfterAction(context, actionToExecute)
          : false;
        if (completedSubtask) {
          forcePlanReason = 'subtask_complete';
          continue;
        }

        if (actionToExecute.type === 'open_tab' || actionToExecute.type === 'switch_tab') {
          forcePlanReason = `${actionToExecute.type}_executed`;
        } else if (context.failureCount >= REPLAN_FAILURE_THRESHOLD) {
          forcePlanReason = 'repeated_action_failure';
        }
      }
    } catch (error) {
      if (!this.isRunCurrent(runId)) return;
      console.error('[SessionManager] Agentic browse failed:', error);
      context.status = 'failed';
      cloudLog('ERROR', 'task_failed', {
        runId,
        goal: context.goal,
        status: 'exception',
        planSummary: context.planSummary,
        activeSubtask: context.activeSubtask,
        durationMs: Date.now() - context.startTime,
        totalActions: context.totalActions,
        failureCount: context.failureCount,
        error: this.serializeLoggingError(error),
      });
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
    const cancelledRunId = this.runGeneration;
    this.invalidateRun();
    cloudLog('INFO', 'session_cancelled', {
      runId: cancelledRunId,
      state: this.state,
      currentTaskGoal: this.currentTask?.goal || null,
      currentTaskStatus: this.currentTask?.status || null,
    });
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
      windowManager.hideWaitingOverlay();
      windowManager.hideBorderOverlay();
    } else {
      windowManager.showSallyBar();
      if (state === 'awaiting_response') {
        windowManager.showWaitingOverlay();
      } else {
        windowManager.hideWaitingOverlay();
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
