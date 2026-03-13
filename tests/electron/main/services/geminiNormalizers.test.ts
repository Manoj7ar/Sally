import { describe, expect, it } from 'vitest';
import {
  normalizeBrowserRescueAnalysis,
  normalizeInterpretResult,
  normalizeScreenQuestionResult,
  normalizeTaskPlan,
} from '../../../../electron/main/services/geminiNormalizers.ts';

describe('geminiNormalizers', () => {
  it('keeps only valid browser actions and sanitizes numeric fields', () => {
    const result = normalizeInterpretResult({
      narration: 'The button is visible.',
      action: {
        type: 'click',
        selector: 'button[type="submit"]',
        index: 2.9,
        framePath: [1, 0, -1, 3.8, 'x'],
        shadowPath: [2, NaN, 4.4],
      },
    });

    expect(result).toEqual({
      narration: 'The button is visible.',
      action: {
        type: 'click',
        selector: 'button[type="submit"]',
        index: 2,
        framePath: [1, 3],
        shadowPath: [2, 4],
      },
    });
  });

  it('drops invalid browser actions instead of returning an unsafe action', () => {
    const result = normalizeInterpretResult({
      narration: '',
      action: {
        type: 'submit_form',
        selector: '#send',
      },
    });

    expect(result).toEqual({
      narration: 'I can see the screen.',
      action: null,
    });
  });

  it('requires a non-empty research query before enabling screen research', () => {
    expect(normalizeScreenQuestionResult({
      answer: 'There are three tabs.',
      shouldResearch: true,
      researchQuery: '   ',
    })).toEqual({
      answer: 'There are three tabs.',
      shouldResearch: false,
      researchQuery: null,
    });
  });

  it('normalizes rescue suggestions and converts null actions to null', () => {
    const result = normalizeBrowserRescueAnalysis({
      pageSummary: 'A modal is blocking the form.',
      blockers: ['A cookie modal covers the fields'],
      suggestions: [
        {
          label: 'Dismiss the modal',
          reason: 'The page is blocked',
          action: { type: 'null' },
          safeToAutoExecute: false,
        },
      ],
    });

    expect(result).toEqual({
      pageSummary: 'A modal is blocking the form.',
      blockers: [
        {
          label: 'A cookie modal covers the fields',
          reason: 'A cookie modal covers the fields',
        },
      ],
      suggestions: [
        {
          label: 'Dismiss the modal',
          reason: 'The page is blocked',
          action: null,
          safeToAutoExecute: false,
        },
      ],
    });
  });

  it('creates a fallback task plan when the model returns no subtasks', () => {
    const result = normalizeTaskPlan({}, 'Open Gmail and draft the email');

    expect(result).toEqual({
      status: 'continue',
      planSummary: 'Open Gmail and draft the email',
      activeSubtask: 'Open Gmail and draft the email',
      subtasks: [
        {
          id: 's1',
          title: 'Open Gmail and draft the email',
          status: 'active',
        },
      ],
      rememberedFacts: [],
      clarificationQuestion: null,
      completionNarration: null,
      blockedReason: null,
    });
  });
});
