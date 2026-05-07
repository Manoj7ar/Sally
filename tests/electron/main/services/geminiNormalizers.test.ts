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

  it('throws when narration is missing or empty', () => {
    expect(() => normalizeInterpretResult({
      narration: '',
      action: {
        type: 'click',
        selector: '#send',
      },
    })).toThrow('missing or empty narration');
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

  it('throws when task plan is missing required fields', () => {
    expect(() => normalizeTaskPlan({})).toThrow('planSummary');
    expect(() => normalizeTaskPlan({ planSummary: 'Do the thing', subtasks: [] })).toThrow('subtasks');
  });

  it('normalizes a complete task plan', () => {
    const result = normalizeTaskPlan({
      status: 'continue',
      planSummary: 'Open Gmail',
      activeSubtask: 'Open inbox',
      subtasks: [{ id: 'a', title: 'Open inbox', status: 'active' }],
      rememberedFacts: [],
    });

    expect(result.planSummary).toBe('Open Gmail');
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0]?.title).toBe('Open inbox');
  });
});
