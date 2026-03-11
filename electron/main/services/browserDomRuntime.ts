/// <reference lib="dom" />

import type { GeminiAction } from './geminiService.js';
import type { PageContext } from './pageContext.js';

export function runDomTaskInPage(payload: {
  mode: 'snapshot' | 'action';
  options?: {
    maxInteractiveElements: number;
    maxVisibleMessages: number;
    maxHeadings: number;
  };
  action?: GeminiAction;
}) {
  const normalize = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeLower = (value: unknown): string => normalize(value).toLowerCase();
  const toNumberPath = (value: unknown): number[] => Array.isArray(value)
    ? value
      .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
      .map((item) => Math.floor(item))
    : [];
  const arraysEqual = (left: number[], right: number[]): boolean => (
    left.length === right.length && left.every((value, index) => value === right[index])
  );

  const getTextFromIds = (element: HTMLElement, ids: string): string => ids
    .split(/\s+/)
    .map((id) => normalize(element.ownerDocument.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ');

  const getChildren = (root: ParentNode | ShadowRoot | Document): HTMLElement[] => Array.from(
    ('children' in root && root.children) ? root.children : [],
  ).filter((node): node is HTMLElement => node instanceof HTMLElement);

  const getAccessibleFrameDocument = (frame: HTMLIFrameElement): Document | null => {
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return null;
      void doc.location.href;
      return doc;
    } catch {
      return null;
    }
  };

  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') <= 0.05) return false;
    if (rect.width < 4 || rect.height < 4) return false;

    return rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= window.innerHeight
      && rect.left <= window.innerWidth;
  };

  const inferRole = (element: HTMLElement): string => {
    const explicitRole = normalizeLower(element.getAttribute('role'));
    if (explicitRole) return explicitRole;

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'a' && element.hasAttribute('href')) return 'link';
    if (tagName === 'button') return 'button';
    if (tagName === 'textarea') return 'textbox';
    if (tagName === 'select') return 'combobox';
    if (tagName === 'summary') return 'button';
    if (tagName === 'option') return 'option';
    if (tagName === 'input') {
      const type = normalizeLower(element.getAttribute('type'));
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (element.getAttribute('contenteditable') === 'true') return 'textbox';
    return 'generic';
  };

  const getDescriptor = (element: HTMLElement) => {
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const labelledBy = normalize(getTextFromIds(element, element.getAttribute('aria-labelledby') || ''));
    const labelSource = element as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> | null };
    const labels = labelSource.labels
      ? Array.from(labelSource.labels).map((label) => normalize(label.textContent)).filter(Boolean).join(' ')
      : '';
    const alt = normalize(element.getAttribute('alt'));
    const title = normalize(element.getAttribute('title'));
    const placeholder = normalize(element.getAttribute('placeholder'));
    const name = normalize(element.getAttribute('name'));
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? normalize(element.value)
      : '';
    const text = normalize(element.innerText || element.textContent || value);
    const label = ariaLabel || labelledBy || labels || alt || title || placeholder || name || text;

    return {
      label,
      text,
      placeholder,
      type: normalizeLower(element.getAttribute('type')) || undefined,
      name,
    };
  };

  const isInteractiveCandidate = (element: HTMLElement, role: string, descriptor: ReturnType<typeof getDescriptor>): boolean => {
    const tagName = element.tagName.toLowerCase();
    if (['a', 'button', 'input', 'textarea', 'select', 'summary', 'option'].includes(tagName)) return true;
    if (element.getAttribute('contenteditable') === 'true') return true;
    if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return true;
    return role !== 'generic' || Boolean(descriptor.label || descriptor.text || descriptor.placeholder);
  };

  const isHeadingElement = (element: HTMLElement): boolean => (
    /^(H1|H2|H3)$/i.test(element.tagName) || normalizeLower(element.getAttribute('role')) === 'heading'
  );

  const isLandmarkElement = (element: HTMLElement): boolean => {
    const tagName = element.tagName.toLowerCase();
    const role = normalizeLower(element.getAttribute('role'));
    return ['header', 'nav', 'main', 'footer', 'aside'].includes(tagName)
      || ['banner', 'navigation', 'main', 'contentinfo', 'search'].includes(role);
  };

  const isDialogElement = (element: HTMLElement): boolean => (
    element.tagName.toLowerCase() === 'dialog'
    || normalizeLower(element.getAttribute('role')) === 'dialog'
    || normalizeLower(element.getAttribute('aria-modal')) === 'true'
  );

  const isMessageElement = (element: HTMLElement): boolean => {
    const classNames = normalizeLower(element.className);
    const testId = normalizeLower(element.getAttribute('data-testid'));
    return ['alert', 'status'].includes(normalizeLower(element.getAttribute('role')))
      || Boolean(element.getAttribute('aria-live'))
      || ['error', 'errors', 'toast', 'notification', 'alert', 'warning'].some((name) => classNames.includes(name))
      || Boolean(element.getAttribute('data-error'))
      || testId.includes('error');
  };

  const getChildIndex = (node: HTMLElement): number => {
    const parent = node.parentNode;
    if (!parent || !('children' in parent)) return 1;
    const siblings = Array.from(parent.children).filter((item): item is HTMLElement => item instanceof HTMLElement);
    const index = siblings.indexOf(node);
    return index >= 0 ? index + 1 : 1;
  };

  const getDomPath = (element: HTMLElement, root: Document | ShadowRoot): number[] => {
    const path: number[] = [];
    let current: HTMLElement | null = element;

    while (current) {
      path.unshift(getChildIndex(current));
      const parent: ParentNode | null = current.parentNode;
      if (!parent || parent === root) break;
      current = parent instanceof HTMLElement ? parent : null;
    }

    return path;
  };

  const buildTargetId = (framePath: number[], shadowPath: number[], domPath: number[]): string => {
    const frame = framePath.length > 0 ? framePath.join('.') : 'root';
    const shadow = shadowPath.length > 0 ? shadowPath.join('.') : 'root';
    const dom = domPath.length > 0 ? domPath.join('.') : 'root';
    return `f:${frame}|s:${shadow}|d:${dom}`;
  };

  const pushUnique = (items: string[], value: string, limit: number): void => {
    const next = normalize(value);
    if (!next || items.includes(next) || items.length >= limit) return;
    items.push(next);
  };

  const getDeepActiveElement = (rootDocument: Document): HTMLElement | null => {
    const seen = new Set<HTMLElement>();
    let current = rootDocument.activeElement instanceof HTMLElement ? rootDocument.activeElement : null;

    while (current && !seen.has(current)) {
      seen.add(current);
      if (current instanceof HTMLIFrameElement) {
        const frameActive = getAccessibleFrameDocument(current)?.activeElement;
        if (frameActive instanceof HTMLElement) {
          current = frameActive;
          continue;
        }
      }

      const shadowActive = current.shadowRoot?.activeElement;
      if (shadowActive instanceof HTMLElement) {
        current = shadowActive;
        continue;
      }

      break;
    }

    return current;
  };

  type InteractiveEntry = {
    index: number;
    targetId: string;
    framePath: number[];
    shadowPath: number[];
    role: string;
    tagName: string;
    label: string;
    text: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    checked?: boolean;
    selected?: boolean;
    expanded?: boolean;
    pressed?: boolean;
    centerX: number;
    centerY: number;
    element: HTMLElement;
  };

  const buildDomState = () => {
    const interactiveEntries: InteractiveEntry[] = [];
    const headings: string[] = [];
    const landmarks: string[] = [];
    const dialogs: string[] = [];
    const visibleMessages: string[] = [];
    let skippedCrossOriginFrames = 0;
    let order = 0;

    const visitRoot = (root: Document | ShadowRoot, context: { framePath: number[]; shadowPath: number[] }) => {
      let frameOrdinal = 0;
      let shadowOrdinal = 0;

      const visitElement = (element: HTMLElement) => {
        const visible = isVisible(element);
        const descriptor = getDescriptor(element);
        const role = inferRole(element);

        if (visible && isInteractiveCandidate(element, role, descriptor)) {
          const rect = element.getBoundingClientRect();
          const expanded = element.getAttribute('aria-expanded');
          const pressed = element.getAttribute('aria-pressed');
          const checked = element instanceof HTMLInputElement
            ? element.checked
            : normalizeLower(element.getAttribute('aria-checked')) === 'true';
          const selected = element instanceof HTMLOptionElement
            ? element.selected
            : normalizeLower(element.getAttribute('aria-selected')) === 'true';

          interactiveEntries.push({
            index: ++order,
            targetId: buildTargetId(context.framePath, context.shadowPath, getDomPath(element, root)),
            framePath: [...context.framePath],
            shadowPath: [...context.shadowPath],
            role,
            tagName: element.tagName.toLowerCase(),
            label: descriptor.label,
            text: descriptor.text,
            placeholder: descriptor.placeholder || undefined,
            type: descriptor.type,
            disabled: element.matches(':disabled') || normalizeLower(element.getAttribute('aria-disabled')) === 'true',
            checked,
            selected,
            expanded: expanded === null ? undefined : normalizeLower(expanded) === 'true',
            pressed: pressed === null ? undefined : normalizeLower(pressed) === 'true',
            centerX: Math.round(rect.left + rect.width / 2),
            centerY: Math.round(rect.top + rect.height / 2),
            element,
          });
        }

        if (visible && isHeadingElement(element)) {
          pushUnique(headings, descriptor.label || descriptor.text, payload.options?.maxHeadings ?? 8);
        }

        if (visible && isLandmarkElement(element)) {
          const landmarkRole = normalize(element.getAttribute('role')) || element.tagName.toLowerCase();
          const name = descriptor.label || descriptor.text;
          pushUnique(landmarks, name ? `${landmarkRole}: ${name}` : landmarkRole, 8);
        }

        if (visible && isDialogElement(element)) {
          pushUnique(dialogs, descriptor.label || descriptor.text, 4);
        }

        if (visible && isMessageElement(element)) {
          pushUnique(visibleMessages, descriptor.text || descriptor.label, payload.options?.maxVisibleMessages ?? 8);
        }

        if (element.shadowRoot?.mode === 'open') {
          shadowOrdinal += 1;
          visitRoot(element.shadowRoot, {
            framePath: [...context.framePath],
            shadowPath: [...context.shadowPath, shadowOrdinal],
          });
        }

        if (element instanceof HTMLIFrameElement) {
          const frameDocument = getAccessibleFrameDocument(element);
          if (frameDocument) {
            frameOrdinal += 1;
            visitRoot(frameDocument, {
              framePath: [...context.framePath, frameOrdinal],
              shadowPath: [...context.shadowPath],
            });
          } else if (visible) {
            skippedCrossOriginFrames += 1;
          }
        }

        getChildren(element).forEach((child) => visitElement(child));
      };

      getChildren(root).forEach((child) => visitElement(child));
    };

    visitRoot(document, { framePath: [], shadowPath: [] });

    const activeElement = getDeepActiveElement(document);
    const activeMatch = activeElement
      ? interactiveEntries.find((entry) => entry.element === activeElement)
      : null;
    const activeDescriptor = activeElement ? getDescriptor(activeElement) : null;
    const activeRole = activeElement ? inferRole(activeElement) : null;

    const semanticParts: string[] = [];
    const title = normalize(document.title);
    if (title) semanticParts.push(`Page title: ${title}`);
    if (headings.length > 0) semanticParts.push(`Top heading: ${headings[0]}`);
    if (interactiveEntries.length > 0) semanticParts.push(`${interactiveEntries.length} visible interactive controls`);
    if (visibleMessages.length > 0) semanticParts.push(`${visibleMessages.length} visible messages`);
    if (skippedCrossOriginFrames > 0) semanticParts.push(`${skippedCrossOriginFrames} inaccessible cross-origin frame${skippedCrossOriginFrames === 1 ? '' : 's'}`);

    return {
      interactiveEntries,
      headings,
      landmarks,
      dialogs,
      visibleMessages,
      activeElement: activeMatch
        ? normalize([activeMatch.role, activeMatch.label || activeMatch.text || activeMatch.placeholder, `[targetId=${activeMatch.targetId}]`].filter(Boolean).join(' '))
        : activeElement && activeDescriptor && activeRole
          ? normalize([activeRole, activeDescriptor.label || activeDescriptor.text || activeDescriptor.placeholder].filter(Boolean).join(' '))
          : null,
      semanticSummary: semanticParts.join('. '),
    };
  };

  const getEditableTarget = (element: HTMLElement): HTMLElement | null => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
    if (element.getAttribute('contenteditable') === 'true') return element;
    const descendant = element.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
    return descendant instanceof HTMLElement ? descendant : null;
  };

  const setInputValue = (element: HTMLElement, value: string): boolean => {
    const editable = getEditableTarget(element);
    if (!editable) return false;

    editable.focus();
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      editable.value = value;
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      editable.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: value, inputType: 'insertText' }));
    editable.textContent = value;
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    return true;
  };

  const readCheckedState = (element: HTMLElement): boolean | null => {
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      return element.checked;
    }

    const ariaChecked = normalizeLower(element.getAttribute('aria-checked'));
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;
    return null;
  };

  const triggerClick = (element: HTMLElement): void => {
    if (element instanceof HTMLAnchorElement) {
      element.target = '_self';
    }
    element.focus();
    element.click();
  };

  const resolveTarget = (action: GeminiAction, entries: InteractiveEntry[]): InteractiveEntry | undefined => {
    const desiredSelector = normalizeLower(action.selector);
    const desiredFramePath = toNumberPath(action.framePath);
    const desiredShadowPath = toNumberPath(action.shadowPath);

    const roleWhitelistByAction: Partial<Record<GeminiAction['type'], string[]>> = {
      click: ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'listbox', 'generic'],
      hover: ['button', 'link', 'tab', 'menuitem', 'option', 'generic'],
      focus: ['textbox', 'searchbox', 'combobox', 'button', 'link', 'generic'],
      fill: ['textbox', 'searchbox', 'combobox', 'generic'],
      select: ['combobox', 'listbox', 'option', 'textbox', 'searchbox', 'generic'],
      check: ['checkbox', 'radio', 'switch', 'generic'],
      uncheck: ['checkbox', 'switch', 'generic'],
    };

    let candidates = entries.filter((entry) => !entry.disabled && (!(roleWhitelistByAction[action.type]) || roleWhitelistByAction[action.type]?.includes(entry.role)));
    if (desiredFramePath.length > 0) {
      const scoped = candidates.filter((entry) => arraysEqual(entry.framePath, desiredFramePath));
      if (scoped.length > 0) candidates = scoped;
    }
    if (desiredShadowPath.length > 0) {
      const scoped = candidates.filter((entry) => arraysEqual(entry.shadowPath, desiredShadowPath));
      if (scoped.length > 0) candidates = scoped;
    }

    if (action.targetId) {
      const exact = candidates.find((entry) => entry.targetId === action.targetId);
      if (exact) return exact;
    }

    const scoreCandidate = (entry: InteractiveEntry): number => {
      if (!desiredSelector) return 1;
      const haystacks = [
        entry.label,
        entry.text,
        entry.placeholder,
        entry.type,
        entry.role,
        entry.tagName,
        entry.targetId,
      ].map(normalizeLower).filter(Boolean);

      let score = 0;
      for (const value of haystacks) {
        if (value === desiredSelector) score = Math.max(score, 120);
        else if (value.startsWith(desiredSelector)) score = Math.max(score, 90);
        else if (value.includes(desiredSelector)) score = Math.max(score, 70);

        const tokens = desiredSelector.split(' ').filter(Boolean);
        const hits = tokens.filter((token) => value.includes(token)).length;
        if (hits > 0) score = Math.max(score, 35 + hits * 10);
      }

      if (desiredFramePath.length > 0 && arraysEqual(entry.framePath, desiredFramePath)) score += 20;
      if (desiredShadowPath.length > 0 && arraysEqual(entry.shadowPath, desiredShadowPath)) score += 20;
      return score;
    };

    if (typeof action.index === 'number' && action.index > 0 && desiredSelector) {
      const ranked = candidates
        .map((entry) => ({ entry, score: scoreCandidate(entry) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.entry.index - right.entry.index);
      const indexed = ranked[action.index - 1]?.entry;
      if (indexed) return indexed;
    }

    if (typeof action.index === 'number' && action.index > 0) {
      return candidates.find((entry) => entry.index === action.index) || candidates[action.index - 1];
    }

    return candidates
      .map((entry) => ({ entry, score: scoreCandidate(entry) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.index - right.entry.index)[0]?.entry;
  };

  if (payload.mode === 'snapshot') {
    const state = buildDomState();
    return {
      interactiveElements: state.interactiveEntries
        .slice(0, payload.options?.maxInteractiveElements ?? 40)
        .map((entry) => ({
          index: entry.index,
          targetId: entry.targetId,
          framePath: entry.framePath,
          shadowPath: entry.shadowPath,
          role: entry.role,
          tagName: entry.tagName,
          label: entry.label,
          text: entry.text,
          placeholder: entry.placeholder,
          type: entry.type,
          disabled: entry.disabled,
          checked: entry.checked,
          selected: entry.selected,
          expanded: entry.expanded,
          pressed: entry.pressed,
          centerX: entry.centerX,
          centerY: entry.centerY,
        })),
      headings: state.headings.slice(0, payload.options?.maxHeadings ?? 8),
      landmarks: state.landmarks.slice(0, 8),
      dialogs: state.dialogs.slice(0, 4),
      visibleMessages: state.visibleMessages.slice(0, payload.options?.maxVisibleMessages ?? 8),
      activeElement: state.activeElement,
      semanticSummary: state.semanticSummary,
    } satisfies PageContext;
  }

  const action = payload.action;
  if (!action) return { ok: false, message: 'missing_action' };

  const state = buildDomState();
  const target = resolveTarget(action, state.interactiveEntries);
  if (!target) return { ok: false, message: 'target_not_found' };

  const descriptor = target.label || target.text || target.placeholder || target.role || target.tagName;
  target.element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

  switch (action.type) {
    case 'click':
      triggerClick(target.element);
      return { ok: true, message: `Clicked "${descriptor}"`, targetIndex: target.index };
    case 'fill': {
      const value = String(action.value ?? '');
      if (!setInputValue(target.element, value)) return { ok: false, message: 'target_not_fillable' };
      return { ok: true, message: `Typed "${value}" into "${descriptor}"`, targetIndex: target.index };
    }
    case 'select': {
      const value = normalize(String(action.value ?? ''));
      if (!value) return { ok: false, message: 'option_not_found' };

      if (target.element instanceof HTMLSelectElement) {
        const option = Array.from(target.element.options).find((candidate) => {
          const optionText = normalizeLower(candidate.textContent);
          return normalizeLower(candidate.value) === normalizeLower(value)
            || optionText === normalizeLower(value)
            || optionText.includes(normalizeLower(value));
        });
        if (!option) return { ok: false, message: 'option_not_found' };
        target.element.value = option.value;
        target.element.dispatchEvent(new Event('input', { bubbles: true }));
        target.element.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: `Selected "${option.textContent || option.value}" in "${descriptor}"`, targetIndex: target.index };
      }

      if (setInputValue(target.element, value)) {
        return { ok: true, message: `Selected "${value}" in "${descriptor}"`, targetIndex: target.index };
      }

      triggerClick(target.element);
      const refreshed = buildDomState().interactiveEntries.filter((entry) => arraysEqual(entry.framePath, target.framePath));
      const optionTarget = refreshed.find((entry) => {
        const optionText = normalizeLower(entry.label || entry.text || entry.placeholder);
        return optionText.includes(normalizeLower(value))
          && ['option', 'menuitem', 'button', 'generic'].includes(entry.role);
      });
      if (!optionTarget) return { ok: false, message: 'option_not_found' };
      triggerClick(optionTarget.element);
      return { ok: true, message: `Selected "${value}" in "${descriptor}"`, targetIndex: optionTarget.index };
    }
    case 'hover':
      target.element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
      target.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
      target.element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
      return { ok: true, message: `Hovered over "${descriptor}"`, point: { x: target.centerX, y: target.centerY }, targetIndex: target.index };
    case 'focus': {
      const focusTarget = getEditableTarget(target.element) || target.element;
      focusTarget.focus();
      const active = getDeepActiveElement(document);
      return { ok: active === focusTarget || document.activeElement === focusTarget, message: `Focused "${descriptor}"`, targetIndex: target.index };
    }
    case 'check':
    case 'uncheck': {
      const desiredChecked = action.type === 'check';
      const checkTarget = getEditableTarget(target.element) || target.element;
      const currentChecked = readCheckedState(checkTarget);
      if (currentChecked !== desiredChecked) {
        if (checkTarget instanceof HTMLInputElement && ['checkbox', 'radio'].includes(checkTarget.type)) {
          checkTarget.checked = desiredChecked;
          checkTarget.dispatchEvent(new Event('input', { bubbles: true }));
          checkTarget.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          triggerClick(checkTarget);
          if (readCheckedState(checkTarget) !== desiredChecked) {
            checkTarget.setAttribute('aria-checked', desiredChecked ? 'true' : 'false');
          }
        }
      }
      return { ok: readCheckedState(checkTarget) === desiredChecked || readCheckedState(checkTarget) === null, message: `${desiredChecked ? 'Checked' : 'Unchecked'} "${descriptor}"`, targetIndex: target.index };
    }
    default:
      return { ok: false, message: 'unsupported_dom_action' };
  }
}

export function extractPageContextInPage(options: {
  maxInteractiveElements: number;
  maxVisibleMessages: number;
  maxHeadings: number;
}): PageContext {
  return runDomTaskInPage({ mode: 'snapshot', options }) as PageContext;
}

export function executeDomActionInPage(action: GeminiAction): { ok: boolean; message: string } {
  return runDomTaskInPage({ mode: 'action', action }) as { ok: boolean; message: string };
}
