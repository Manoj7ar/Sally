import type { BrowserActionRequest, BrowserActionType } from '../../../shared/types.js';
import type {
  GeminiAction,
  GeminiBrowserAssistiveIntent,
  GeminiBrowserRescueAnalysis,
  GeminiBrowserRescueBlocker,
  GeminiBrowserRescueSuggestion,
  GeminiEmailDraft,
  GeminiInterpretResult,
  GeminiScreenQuestionResult,
  GeminiTaskPlan,
  GeminiTaskSubtask,
  GeminiUserRequestIntent,
  GeminiUserRequestInterpretation,
} from './geminiService.js';

const VALID_ACTION_TYPES = [
  'navigate', 'click', 'fill', 'type', 'select', 'press',
  'hover', 'focus', 'check', 'uncheck', 'scroll', 'scroll_up', 'back', 'wait',
  'open_tab', 'switch_tab', 'null',
] as const satisfies readonly BrowserActionType[];

export function isBrowserActionType(value: unknown): value is BrowserActionType {
  return typeof value === 'string' && VALID_ACTION_TYPES.includes(value as BrowserActionType);
}

function normalizeActionCandidate(candidate: Record<string, unknown>): BrowserActionRequest | null {
  if (!isBrowserActionType(candidate.type)) {
    return null;
  }

  const action: BrowserActionRequest = { type: candidate.type };

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

  return action;
}

export function normalizeInterpretResult(raw: Record<string, unknown>): GeminiInterpretResult {
  if (typeof raw.narration !== 'string' || !raw.narration.trim()) {
    throw new Error('Gemini response missing or empty narration');
  }
  const narration = raw.narration.trim();

  let action: GeminiAction | null = null;
  if (raw.action && typeof raw.action === 'object' && !Array.isArray(raw.action)) {
    action = normalizeActionCandidate(raw.action as Record<string, unknown>);
  }

  return { narration, action };
}

export function normalizeScreenQuestionResult(raw: Record<string, unknown>): GeminiScreenQuestionResult {
  if (typeof raw.answer !== 'string' || !raw.answer.trim()) {
    throw new Error('Gemini response missing or empty answer');
  }
  const answer = raw.answer.trim();

  const researchQuery = typeof raw.researchQuery === 'string' && raw.researchQuery.trim()
    ? raw.researchQuery.trim()
    : null;

  return {
    answer,
    shouldResearch: Boolean(raw.shouldResearch) && Boolean(researchQuery),
    researchQuery,
  };
}

export function normalizeBrowserRescueAnalysis(raw: Record<string, unknown>): GeminiBrowserRescueAnalysis {
  if (typeof raw.pageSummary !== 'string' || !raw.pageSummary.trim()) {
    throw new Error('Gemini response missing or empty pageSummary');
  }
  const pageSummary = raw.pageSummary.trim();

  const blockers: GeminiBrowserRescueBlocker[] = Array.isArray(raw.blockers)
    ? raw.blockers
      .map((item, index) => {
        if (typeof item === 'string' && item.trim()) {
          return {
            label: item.trim(),
            reason: item.trim(),
          };
        }

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const candidate = item as Record<string, unknown>;
        return {
          label: typeof candidate.label === 'string' && candidate.label.trim()
            ? candidate.label.trim()
            : `Blocker ${index + 1}`,
          reason: typeof candidate.reason === 'string' && candidate.reason.trim()
            ? candidate.reason.trim()
            : 'This appears to be blocking progress on the page.',
        };
      })
      .filter((item): item is GeminiBrowserRescueBlocker => Boolean(item))
      .slice(0, 4)
    : [];

  const suggestions: GeminiBrowserRescueSuggestion[] = Array.isArray(raw.suggestions)
    ? raw.suggestions
      .map((item, index) => {
        if (typeof item === 'string' && item.trim()) {
          return {
            label: `Suggestion ${index + 1}`,
            reason: item.trim(),
            action: null,
            safeToAutoExecute: false,
          };
        }

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const candidate = item as Record<string, unknown>;
        let action: GeminiAction | null = null;

        if (candidate.action && typeof candidate.action === 'object' && !Array.isArray(candidate.action)) {
          const normalizedAction = normalizeActionCandidate(candidate.action as Record<string, unknown>);
          action = normalizedAction?.type === 'null' ? null : normalizedAction;
        }

        return {
          label: typeof candidate.label === 'string' && candidate.label.trim()
            ? candidate.label.trim()
            : `Suggestion ${index + 1}`,
          reason: typeof candidate.reason === 'string' && candidate.reason.trim()
            ? candidate.reason.trim()
            : 'This looks like the best next step.',
          action,
          safeToAutoExecute: Boolean(candidate.safeToAutoExecute),
        };
      })
      .filter((item): item is GeminiBrowserRescueSuggestion => Boolean(item))
      .slice(0, 4)
    : [];

  return { pageSummary, blockers, suggestions };
}

export function normalizeUserRequestIntent(value: unknown): GeminiUserRequestIntent {
  switch (value) {
    case 'browser_task':
    case 'browser_assistive':
    case 'browser_rescue':
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

export function normalizeBrowserAssistiveIntent(value: unknown): GeminiBrowserAssistiveIntent | null {
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

const USER_REQUEST_INTENTS: GeminiUserRequestIntent[] = [
  'browser_task',
  'browser_assistive',
  'browser_rescue',
  'describe_screen',
  'summarize_screen',
  'screen_question',
  'smart_home',
  'chat',
  'cancel',
  'clarify',
  'none',
];

export function normalizeUserRequestInterpretation(
  raw: Record<string, unknown>,
  transcript: string,
): GeminiUserRequestInterpretation {
  if (typeof raw.intent !== 'string' || !USER_REQUEST_INTENTS.includes(raw.intent as GeminiUserRequestIntent)) {
    throw new Error(`Gemini response invalid or missing intent: ${String(raw.intent)}`);
  }
  const intent = raw.intent as GeminiUserRequestIntent;
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
  const browserAssistiveIntent = normalizeBrowserAssistiveIntent(raw.browserAssistiveIntent);

  return {
    intent,
    confidence,
    normalizedInstruction,
    spokenResponse,
    clarificationQuestion,
    browserAssistiveIntent,
  };
}

export function normalizeTaskPlan(raw: Record<string, unknown>): GeminiTaskPlan {
  const status = raw.status === 'complete' || raw.status === 'blocked' || raw.status === 'clarify'
    ? raw.status
    : 'continue';
  if (typeof raw.planSummary !== 'string' || !raw.planSummary.trim()) {
    throw new Error('Gemini response missing or empty planSummary');
  }
  const planSummary = raw.planSummary.trim();
  const activeSubtask = typeof raw.activeSubtask === 'string' && raw.activeSubtask.trim()
    ? raw.activeSubtask.trim()
    : null;

  if (!Array.isArray(raw.subtasks) || raw.subtasks.length === 0) {
    throw new Error('Gemini response missing or empty subtasks');
  }

  const subtasks: GeminiTaskSubtask[] = raw.subtasks
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .slice(0, 6)
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `s${index + 1}`,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Step ${index + 1}`,
      status: item.status === 'done' || item.status === 'blocked' || item.status === 'active'
        ? item.status
        : 'pending',
    }));

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

  return {
    status,
    planSummary,
    activeSubtask: activeSubtask || subtasks.find((item) => item.status === 'active')?.title || subtasks.find((item) => item.status === 'pending')?.title || null,
    subtasks,
    rememberedFacts,
    clarificationQuestion,
    completionNarration,
    blockedReason,
  };
}

export function normalizeEmailDraft(raw: Record<string, unknown>): GeminiEmailDraft {
  if (typeof raw.subject !== 'string' || !raw.subject.trim()) {
    throw new Error('Gemini response missing or empty email subject');
  }
  if (typeof raw.body !== 'string' || !raw.body.trim()) {
    throw new Error('Gemini response missing or empty email body');
  }

  return {
    subject: raw.subject.trim(),
    body: raw.body.trim(),
  };
}
