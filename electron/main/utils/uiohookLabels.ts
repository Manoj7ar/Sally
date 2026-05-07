// Friendly labels for uiohook-napi keycodes.
//
// uIOhook reports raw integer keycodes (the same constants exposed by
// `UiohookKey`). Users would rather see "Right Option" than "AltRight" or
// "65043", so we keep a small override table for the keys most likely to
// appear in a push-to-talk shortcut and fall back to a prettified version of
// the enum identifier for everything else.

import { UiohookKey } from 'uiohook-napi';

/** macOS-flavored display strings for the keys we expect users to bind.
 *  uiohook-napi uses bare names for the left-side modifiers (`Alt`, `Ctrl`,
 *  `Meta`, `Shift`) and explicit `*Right` suffix for the right-side ones. */
const PRETTY_OVERRIDES: Record<string, string> = {
  Alt: 'Left Option',
  AltRight: 'Right Option',
  Ctrl: 'Left Control',
  CtrlRight: 'Right Control',
  Meta: 'Left Command',
  MetaRight: 'Right Command',
  Shift: 'Left Shift',
  ShiftRight: 'Right Shift',
  Space: 'Space',
  Enter: 'Return',
  Escape: 'Esc',
  Backspace: 'Delete',
  Tab: 'Tab',
  CapsLock: 'Caps Lock',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

let cachedReverseMap: Record<number, string> | null = null;

function buildReverseMap(): Record<number, string> {
  if (cachedReverseMap) return cachedReverseMap;
  const map: Record<number, string> = {};
  for (const [name, value] of Object.entries(UiohookKey)) {
    if (typeof value === 'number' && !(value in map)) {
      map[value] = name;
    }
  }
  cachedReverseMap = map;
  return map;
}

function prettifyEnumName(name: string): string {
  // KeyA → A, Digit1 → 1
  if (/^Key[A-Z]$/.test(name)) return name.slice(3);
  if (/^Digit\d$/.test(name)) return name.slice(5);
  if (/^Numpad/.test(name)) return `Numpad ${name.slice(6) || ''}`.trim();
  if (/^F\d{1,2}$/.test(name)) return name; // F1, F12
  // FooBar → Foo Bar
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
}

export function labelForKeycode(keycode: number): string {
  const name = buildReverseMap()[keycode];
  if (!name) return `Key ${keycode}`;
  return PRETTY_OVERRIDES[name] ?? prettifyEnumName(name);
}

export function labelForKeycodes(keycodes: readonly number[]): string {
  if (!keycodes.length) return 'Not set';
  return keycodes.map(labelForKeycode).join(' + ');
}

/** Default push-to-talk shortcut on macOS. Also used by reset-to-default. */
export const DEFAULT_PUSH_TO_TALK_KEYCODES: readonly number[] = [UiohookKey.AltRight];

/**
 * Strict validator for stored values: keep only finite, positive integers and
 * dedupe while preserving press order. Caller decides what to do with empty
 * results (typically: fall back to the default).
 */
export function sanitizeKeycodeList(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of input) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const code = Math.trunc(value);
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
