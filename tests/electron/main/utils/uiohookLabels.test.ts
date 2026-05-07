import { describe, expect, it } from 'vitest';
import { UiohookKey } from 'uiohook-napi';
import {
  DEFAULT_PUSH_TO_TALK_KEYCODES,
  labelForKeycode,
  labelForKeycodes,
  sanitizeKeycodeList,
} from '../../../../electron/main/utils/uiohookLabels';

describe('labelForKeycode', () => {
  it('uses the macOS-friendly override for Right Option', () => {
    expect(labelForKeycode(UiohookKey.AltRight)).toBe('Right Option');
  });

  it('uses the macOS-friendly override for the command keys', () => {
    expect(labelForKeycode(UiohookKey.Meta)).toBe('Left Command');
    expect(labelForKeycode(UiohookKey.MetaRight)).toBe('Right Command');
  });

  it('returns the bare letter for KeyA-style enum members', () => {
    expect(labelForKeycode(UiohookKey.A)).toBe('A');
  });

  it('falls back to "Key <code>" for unknown keycodes', () => {
    expect(labelForKeycode(99_999_999)).toBe('Key 99999999');
  });
});

describe('labelForKeycodes', () => {
  it('joins multi-key combos with " + "', () => {
    const combo = [UiohookKey.Meta, UiohookKey.Space];
    expect(labelForKeycodes(combo)).toBe('Left Command + Space');
  });

  it('renders an empty combo as "Not set"', () => {
    expect(labelForKeycodes([])).toBe('Not set');
  });
});

describe('sanitizeKeycodeList', () => {
  it('keeps only finite positive integers and dedupes preserving order', () => {
    const input = [
      UiohookKey.AltRight,
      0,
      -1,
      Number.NaN,
      'AltLeft',
      UiohookKey.AltRight,
      UiohookKey.Space,
    ];
    const out = sanitizeKeycodeList(input);
    expect(out).toEqual([UiohookKey.AltRight, UiohookKey.Space]);
  });

  it('returns an empty array for non-array input', () => {
    expect(sanitizeKeycodeList(null)).toEqual([]);
    expect(sanitizeKeycodeList(undefined)).toEqual([]);
    expect(sanitizeKeycodeList('AltRight')).toEqual([]);
  });
});

describe('DEFAULT_PUSH_TO_TALK_KEYCODES', () => {
  it('points at Right Option', () => {
    expect(DEFAULT_PUSH_TO_TALK_KEYCODES).toEqual([UiohookKey.AltRight]);
  });
});
