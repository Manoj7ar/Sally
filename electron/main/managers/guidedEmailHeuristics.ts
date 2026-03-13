import type { GeminiTaskSubtask } from '../services/geminiService.js';

const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function normalizeLooseText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s@.'+-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeEmailCandidate(email: string): string {
  return email.trim().replace(/[>,.;!?]+$/g, '').toLowerCase();
}

export function extractRecipientEmailCandidate(goal: string): { email: string | null; needsConfirmation: boolean } {
  const directMatch = goal.match(EMAIL_ADDRESS_PATTERN)?.[0];
  if (directMatch) {
    const email = normalizeEmailCandidate(directMatch);
    return {
      email,
      needsConfirmation: isSuspiciousRecipientEmail(email),
    };
  }

  const spokenNormalized = goal
    .toLowerCase()
    .replace(/\b(?:at)\b/g, '@')
    .replace(/\b(?:dot|period)\b/g, '.')
    .replace(/\b(?:underscore)\b/g, '_')
    .replace(/\b(?:dash|hyphen)\b/g, '-')
    .replace(/\b(?:plus)\b/g, '+')
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*_\s*/g, '_');
  const spokenMatch = spokenNormalized.match(EMAIL_ADDRESS_PATTERN)?.[0];
  if (!spokenMatch) {
    return { email: null, needsConfirmation: false };
  }

  return {
    email: normalizeEmailCandidate(spokenMatch),
    needsConfirmation: true,
  };
}

export function isSuspiciousRecipientEmail(email: string): boolean {
  const [localPart = '', domain = ''] = email.split('@');
  const domainParts = domain.split('.').filter(Boolean);
  return (
    localPart.length < 3
    || domainParts.length < 2
    || domainParts.some((part) => part.length < 2)
    || /[._%+-]{2,}/.test(email)
  );
}

export function isGuidedEmailComposeGoal(goal: string): boolean {
  const recipient = extractRecipientEmailCandidate(goal);
  const normalized = normalizeLooseText(goal);
  return Boolean(recipient.email)
    && /\b(compose|draft|write|email)\b/i.test(normalized)
    && !/\b(linkedin page|official website|company website|remember key facts)\b/i.test(normalized);
}

export function buildGuidedEmailSubtasks(goal: string): GeminiTaskSubtask[] | null {
  if (!isGuidedEmailComposeGoal(goal)) {
    return null;
  }

  const recipientEmail = extractRecipientEmailCandidate(goal).email || 'the requested recipient';
  return [
    { id: 's1', title: 'Open Gmail', status: 'active' },
    { id: 's2', title: 'Click Compose', status: 'pending' },
    { id: 's3', title: `Address the draft to ${recipientEmail}`, status: 'pending' },
    { id: 's4', title: 'Ask whether to continue', status: 'pending' },
    { id: 's5', title: 'Draft the email content', status: 'pending' },
    { id: 's6', title: 'Ask whether to send it', status: 'pending' },
  ];
}
