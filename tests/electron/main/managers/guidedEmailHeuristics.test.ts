import { describe, expect, it } from 'vitest';
import {
  buildGuidedEmailSubtasks,
  extractRecipientEmailCandidate,
  isGuidedEmailComposeGoal,
  isSuspiciousRecipientEmail,
} from '../../../../electron/main/managers/guidedEmailHeuristics.ts';

describe('guidedEmailHeuristics', () => {
  it('extracts direct email addresses without forcing confirmation for normal addresses', () => {
    expect(extractRecipientEmailCandidate('Draft an email to manoj07ar@gmail.com')).toEqual({
      email: 'manoj07ar@gmail.com',
      needsConfirmation: false,
    });
  });

  it('treats spoken email patterns as confirm-first recipients', () => {
    expect(extractRecipientEmailCandidate('Write an email to manoj07ar at gmail dot com')).toEqual({
      email: 'manoj07ar@gmail.com',
      needsConfirmation: true,
    });
  });

  it('flags suspicious recipient addresses', () => {
    expect(isSuspiciousRecipientEmail('ab@x.c')).toBe(true);
    expect(isSuspiciousRecipientEmail('manoj07ar@gmail.com')).toBe(false);
  });

  it('only enables guided compose mode for real email drafting goals', () => {
    expect(isGuidedEmailComposeGoal('Draft an email to manoj07ar@gmail.com')).toBe(true);
    expect(isGuidedEmailComposeGoal('Open Manoj LinkedIn page and remember key facts')).toBe(false);
  });

  it('builds the Gmail-oriented guided email subtasks in the expected order', () => {
    expect(buildGuidedEmailSubtasks('Compose an email to manoj07ar@gmail.com')).toEqual([
      { id: 's1', title: 'Open Gmail', status: 'active' },
      { id: 's2', title: 'Click Compose', status: 'pending' },
      { id: 's3', title: 'Address the draft to manoj07ar@gmail.com', status: 'pending' },
      { id: 's4', title: 'Ask whether to continue', status: 'pending' },
      { id: 's5', title: 'Draft the email content', status: 'pending' },
      { id: 's6', title: 'Ask whether to send it', status: 'pending' },
    ]);
  });
});
