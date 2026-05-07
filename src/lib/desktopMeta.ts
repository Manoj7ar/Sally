import { PUSH_TO_TALK_KEY_LABEL } from '../../shared/pushToTalkLabel';

/** Push-to-talk modifier label for the current desktop (from preload when in Electron). */
export function getPushToTalkKeyLabel(): string {
  if (typeof window !== 'undefined' && window.electron?.pushToTalkKeyLabel) {
    return window.electron.pushToTalkKeyLabel;
  }
  return PUSH_TO_TALK_KEY_LABEL;
}
