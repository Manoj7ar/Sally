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
  const narration = typeof raw.narration === 'string' && raw.narration
    ? raw.narration
    : 'I can see the screen.';

  let action: GeminiAction | null = null;
  if (raw.action && typeof raw.action === 'object' && !Array.isArray(raw.action)) {
    action = normalizeActionCandidate(raw.action as Record<string, unknown>);
  }

  return { narration, action };
}

export function normalizeScreenQuestionResult(raw: Record<string, unknown>): GeminiScreenQuestionResult {
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

export function normalizeBrowserRescueAnalysis(raw: Record<string, unknown>): GeminiBrowserRescueAnalysis {
  const pageSummary = typeof raw.pageSummary === 'string' && raw.pageSummary.trim()
    ? raw.pageSummary.trim()
    : 'I can inspect this page and help with the next step.';

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
          const normalizedAction = normalizeInterpretResult({ narration: '', action: candidate.action }).action;
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

export function normalizeUserRequestInterpretation(
  raw: Record<string, unknown>,
  transcript: string,
): GeminiUserRequestInterpretation {
  const intent = normalizeUserRequestIntent(raw.intent);
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

export function normalizeTaskPlan(raw: Record<string, unknown>, goal: string): GeminiTaskPlan {
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

export function normalizeEmailDraft(raw: Record<string, unknown>, brief: string): GeminiEmailDraft {
  const subject = typeof raw.subject === 'string' && raw.subject.trim()
    ? raw.subject.trim()
    : 'Quick follow-up';
  const fallbackBody = `Hi,\n\n${brief.trim() || 'I wanted to follow up with you.'}\n\nBest,\nManoj`;
  const body = typeof raw.body === 'string' && raw.body.trim()
    ? raw.body.trim()
    : fallbackBody;

  return {
    subject,
    body,
  };
}
