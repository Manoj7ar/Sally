import { PUSH_TO_TALK_KEY_LABEL } from '../../shared/pushToTalkLabel';

// Sally is macOS only, so the push-to-talk modifier is always Right Option.
// Kept as a function so callers can stay agnostic to where the label lives.
export function getPushToTalkKeyLabel(): string {
  return PUSH_TO_TALK_KEY_LABEL;
}
