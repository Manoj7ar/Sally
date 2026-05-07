import { describe, expect, it } from 'vitest';
import { PUSH_TO_TALK_KEY_LABEL } from '../../shared/pushToTalkLabel';

describe('PUSH_TO_TALK_KEY_LABEL', () => {
  it('uses Right Option (Sally is macOS only)', () => {
    expect(PUSH_TO_TALK_KEY_LABEL).toBe('Right Option');
  });
});
