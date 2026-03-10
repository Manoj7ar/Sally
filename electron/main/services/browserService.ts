/// <reference lib="dom" />

import { BrowserWindow, screen } from 'electron';
import type { GeminiAction } from './geminiService.js';
import type { BrowserSnapshot, BrowserSourceMode, PageContext } from './pageContext.js';

const BROWSER_PARTITION = 'persist:sally-browser';
const MAX_INTERACTIVE_ELEMENTS = 24;
const MAX_VISIBLE_MESSAGES = 8;
const MAX_HEADINGS = 8;
const MIN_SETTLE_DELAY_MS = 600;
const MAX_SETTLE_DELAY_MS = 3_000;

function extractPageContextInPage(options: {
  maxInteractiveElements: number;
  maxVisibleMessages: number;
  maxHeadings: number;
}) {
  const normalize = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();
  const getTextFromIds = (ids: string): string => ids
    .split(/\s+/)
    .map((id) => normalize(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ');

  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    if (Number(style.opacity || '1') <= 0.05) {
      return false;
    }

    if (rect.width < 4 || rect.height < 4) {
      return false;
    }

    return rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= window.innerHeight
      && rect.left <= window.innerWidth;
  };

  const inferRole = (element: HTMLElement): string => {
    const explicitRole = normalize(element.getAttribute('role'));
    if (explicitRole) {
      return explicitRole.toLowerCase();
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'a' && element.hasAttribute('href')) return 'link';
    if (tagName === 'button') return 'button';
    if (tagName === 'textarea') return 'textbox';
    if (tagName === 'select') return 'combobox';
    if (tagName === 'summary') return 'button';
    if (tagName === 'input') {
      const type = normalize(element.getAttribute('type')).toLowerCase();
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
    const labelledBy = normalize(getTextFromIds(element.getAttribute('aria-labelledby') || ''));
    const labelSource = element as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> | null };
    const labels = labelSource.labels
      ? Array.from(labelSource.labels).map((label) => normalize(label.textContent)).filter(Boolean).join(' ')
      : '';
    const alt = normalize(element.getAttribute('alt'));
    const title = normalize(element.getAttribute('title'));
    const placeholder = normalize(element.getAttribute('placeholder'));
    const name = normalize(element.getAttribute('name'));
    const text = normalize(element.innerText || element.textContent);
    const label = ariaLabel || labelledBy || labels || alt || title || placeholder || name || text;

    return {
      label,
      text,
      placeholder,
      type: normalize(element.getAttribute('type')).toLowerCase() || undefined,
      name,
    };
  };

  const interactiveSelectors = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');

  const interactiveElements = Array.from(document.querySelectorAll(interactiveSelectors))
    .filter(isVisible)
    .map((element) => {
      const descriptor = getDescriptor(element);
      const role = inferRole(element);
      return {
        element,
        role,
        tagName: element.tagName.toLowerCase(),
        ...descriptor,
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        checked: (element as HTMLInputElement).checked === true || element.getAttribute('aria-checked') === 'true',
        selected: (element as HTMLOptionElement).selected === true || element.getAttribute('aria-selected') === 'true',
      };
    })
    .filter((entry) => entry.role !== 'generic' || Boolean(entry.label || entry.text || entry.placeholder))
    .slice(0, options.maxInteractiveElements)
    .map((entry, index) => ({
      index: index + 1,
      role: entry.role,
      tagName: entry.tagName,
      label: entry.label,
      text: entry.text,
      placeholder: entry.placeholder,
      type: entry.type,
      disabled: entry.disabled,
      checked: entry.checked,
      selected: entry.selected,
    }));

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .filter(isVisible)
    .map((element) => normalize((element as HTMLElement).innerText || element.textContent))
    .filter(Boolean)
    .slice(0, options.maxHeadings);

  const landmarks = Array.from(document.querySelectorAll('[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="search"], header, nav, main, footer, aside'))
    .filter(isVisible)
    .map((element) => {
      const node = element as HTMLElement;
      const role = normalize(node.getAttribute('role')) || node.tagName.toLowerCase();
      const name = getDescriptor(node).label;
      return name ? `${role}: ${name}` : role;
    })
    .filter(Boolean)
    .slice(0, 8);

  const dialogs = Array.from(document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]'))
    .filter(isVisible)
    .map((element) => getDescriptor(element as HTMLElement).label || normalize((element as HTMLElement).innerText || element.textContent))
    .filter(Boolean)
    .slice(0, 4);

  const messageSelectors = [
    '[role="alert"]',
    '[role="status"]',
    '[aria-live]',
    '.error',
    '.errors',
    '.toast',
    '.notification',
    '.alert',
    '.warning',
    '[data-error]',
    '[data-testid*="error"]',
  ].join(',');

  const visibleMessages = Array.from(document.querySelectorAll(messageSelectors))
    .filter(isVisible)
    .map((element) => normalize((element as HTMLElement).innerText || element.textContent))
    .filter(Boolean)
    .slice(0, options.maxVisibleMessages);

  const activeElement = document.activeElement instanceof HTMLElement
    ? (() => {
      const descriptor = getDescriptor(document.activeElement);
      const role = inferRole(document.activeElement);
      return normalize([role, descriptor.label || descriptor.text || descriptor.placeholder].filter(Boolean).join(' ')) || null;
    })()
    : null;

  const semanticParts: string[] = [];
  const title = normalize(document.title);
  if (title) semanticParts.push(`Page title: ${title}`);
  if (headings.length > 0) semanticParts.push(`Top heading: ${headings[0]}`);
  if (interactiveElements.length > 0) semanticParts.push(`${interactiveElements.length} visible interactive controls`);
  if (visibleMessages.length > 0) semanticParts.push(`${visibleMessages.length} visible messages`);

  return {
    interactiveElements,
    headings,
    landmarks,
    dialogs,
    visibleMessages,
    activeElement,
    semanticSummary: semanticParts.join('. '),
  };
}

function runDomActionInPage(payload: { action: GeminiAction }) {
  const { action } = payload;

  const normalize = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const getTextFromIds = (ids: string): string => ids
    .split(/\s+/)
    .map((id) => normalize(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ');

  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    if (Number(style.opacity || '1') <= 0.05) {
      return false;
    }
    if (rect.width < 4 || rect.height < 4) {
      return false;
    }

    return rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= window.innerHeight
      && rect.left <= window.innerWidth;
  };

  const inferRole = (element: HTMLElement): string => {
    const explicitRole = normalize(element.getAttribute('role'));
    if (explicitRole) return explicitRole;

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'a' && element.hasAttribute('href')) return 'link';
    if (tagName === 'button') return 'button';
    if (tagName === 'textarea') return 'textbox';
    if (tagName === 'select') return 'combobox';
    if (tagName === 'summary') return 'button';
    if (tagName === 'input') {
      const type = normalize(element.getAttribute('type'));
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
    const labelledBy = normalize(getTextFromIds(element.getAttribute('aria-labelledby') || ''));
    const labelSource = element as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> | null };
    const labels = labelSource.labels
      ? Array.from(labelSource.labels).map((label) => normalize(label.textContent)).filter(Boolean).join(' ')
      : '';
    const alt = normalize(element.getAttribute('alt'));
    const title = normalize(element.getAttribute('title'));
    const placeholder = normalize(element.getAttribute('placeholder'));
    const name = normalize(element.getAttribute('name'));
    const text = normalize(element.innerText || element.textContent);
    const label = ariaLabel || labelledBy || labels || alt || title || placeholder || name || text;
    return { label, text, placeholder, name };
  };

  const interactiveSelectors = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');

  const inventory = Array.from(document.querySelectorAll(interactiveSelectors))
    .filter(isVisible)
    .map((element, index) => {
      const node = element as HTMLElement;
      const descriptor = getDescriptor(node);
      const role = inferRole(node);
      const rect = node.getBoundingClientRect();
      return {
        index: index + 1,
        element: node,
        role,
        tagName: node.tagName.toLowerCase(),
        label: descriptor.label,
        text: descriptor.text,
        placeholder: descriptor.placeholder,
        name: descriptor.name,
        disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true',
        type: normalize(node.getAttribute('type')),
        rect: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        },
      };
    })
    .filter((entry) => entry.role !== 'generic' || Boolean(entry.label || entry.text || entry.placeholder));

  const desiredSelector = normalize(action.selector);

  const roleWhitelistByAction: Partial<Record<GeminiAction['type'], string[]>> = {
    click: ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'generic'],
    hover: ['button', 'link', 'tab', 'menuitem', 'generic'],
    focus: ['textbox', 'searchbox', 'combobox', 'button', 'link', 'generic'],
    fill: ['textbox', 'searchbox', 'combobox'],
    select: ['combobox', 'listbox'],
    check: ['checkbox', 'radio', 'switch'],
    uncheck: ['checkbox', 'switch'],
  };

  const allowedRoles = roleWhitelistByAction[action.type] || null;
  const candidates = inventory.filter((entry) => !entry.disabled && (!allowedRoles || allowedRoles.includes(entry.role)));

  const scoreCandidate = (entry: typeof candidates[number]): number => {
    if (!desiredSelector) {
      return 1;
    }

    const haystacks = [
      entry.label,
      entry.text,
      entry.placeholder,
      entry.name,
      entry.role,
      entry.tagName,
    ].map(normalize).filter(Boolean);

    let score = 0;
    for (const value of haystacks) {
      if (value === desiredSelector) {
        score = Math.max(score, 120);
      } else if (value.startsWith(desiredSelector)) {
        score = Math.max(score, 90);
      } else if (value.includes(desiredSelector)) {
        score = Math.max(score, 70);
      }

      const desiredTokens = desiredSelector.split(' ').filter(Boolean);
      const tokenHits = desiredTokens.filter((token) => value.includes(token)).length;
      if (tokenHits > 0) {
        score = Math.max(score, 35 + tokenHits * 10);
      }
    }

    return score;
  };

  let target: typeof candidates[number] | undefined;
  if (typeof action.index === 'number' && action.index > 0 && desiredSelector) {
    const ranked = candidates
      .map((entry) => ({ entry, score: scoreCandidate(entry) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.index - b.entry.index);
    target = ranked[action.index - 1]?.entry;
  }

  if (!target && typeof action.index === 'number' && action.index > 0) {
    target = candidates.find((entry) => entry.index === action.index) || candidates[action.index - 1];
  }

  if (!target) {
    const ranked = candidates
      .map((entry) => ({ entry, score: scoreCandidate(entry) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.index - b.entry.index);
    target = ranked[0]?.entry;
  }

  if (!target) {
    return { ok: false, message: 'target_not_found' };
  }

  target.element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const descriptor = target.label || target.text || target.placeholder || target.role || target.tagName;

  const setInputValue = (element: HTMLElement, value: string) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (element instanceof HTMLElement && element.getAttribute('contenteditable') === 'true') {
      element.focus();
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      return true;
    }

    return false;
  };

  switch (action.type) {
    case 'click': {
      if (target.element instanceof HTMLAnchorElement) {
        target.element.target = '_self';
      }
      target.element.focus();
      target.element.click();
      return { ok: true, message: `Clicked "${descriptor}"`, targetIndex: target.index };
    }

    case 'fill': {
      const value = String(action.value ?? '');
      if (!setInputValue(target.element, value)) {
        return { ok: false, message: 'target_not_fillable' };
      }
      return { ok: true, message: `Typed "${value}" into "${descriptor}"`, targetIndex: target.index };
    }

    case 'select': {
      const value = normalize(action.value);
      if (target.element instanceof HTMLSelectElement) {
        const option = Array.from(target.element.options).find((candidate) => {
          const optionText = normalize(candidate.textContent);
          return normalize(candidate.value) === value || optionText === value || optionText.includes(value);
        });

        if (!option) {
          return { ok: false, message: 'option_not_found' };
        }

        target.element.value = option.value;
        target.element.dispatchEvent(new Event('input', { bubbles: true }));
        target.element.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: `Selected "${option.textContent || option.value}" in "${descriptor}"`, targetIndex: target.index };
      }

      if (setInputValue(target.element, String(action.value ?? ''))) {
        return { ok: true, message: `Selected "${String(action.value ?? '')}" in "${descriptor}"`, targetIndex: target.index };
      }

      return { ok: false, message: 'target_not_selectable' };
    }

    case 'hover': {
      target.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
      target.element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
      return { ok: true, message: `Hovered over "${descriptor}"`, point: target.rect, targetIndex: target.index };
    }

    case 'focus': {
      target.element.focus();
      return { ok: document.activeElement === target.element, message: `Focused "${descriptor}"`, targetIndex: target.index };
    }

    case 'check':
    case 'uncheck': {
      const desiredChecked = action.type === 'check';
      if (target.element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.element.type)) {
        target.element.focus();
        target.element.checked = desiredChecked;
        target.element.dispatchEvent(new Event('input', { bubbles: true }));
        target.element.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          ok: target.element.checked === desiredChecked,
          message: `${desiredChecked ? 'Checked' : 'Unchecked'} "${descriptor}"`,
          targetIndex: target.index,
        };
      }

      target.element.setAttribute('aria-checked', desiredChecked ? 'true' : 'false');
      target.element.click();
      return {
        ok: true,
        message: `${desiredChecked ? 'Checked' : 'Unchecked'} "${descriptor}"`,
        targetIndex: target.index,
      };
    }

    default:
      return { ok: false, message: 'unsupported_dom_action' };
  }
}

class BrowserService {
  private browserWindow: BrowserWindow | null = null;
  private launchNotice: string | null = null;
  private controlMode: BrowserSourceMode = 'electron_browser';

  getSourceMode(): BrowserSourceMode {
    return this.controlMode;
  }

  consumeLaunchNotice(): string | null {
    const notice = this.launchNotice;
    this.launchNotice = null;
    return notice;
  }

  async launch(startUrl?: string): Promise<BrowserWindow> {
    const window = await this.ensureWindow(startUrl);

    if (startUrl && this.browserWindow === window) {
      await this.ensurePageUrl(window, startUrl);
    } else if (!this.hasRealContent(window.webContents.getURL())) {
      await this.ensurePageUrl(window, 'https://www.google.com');
    }

    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();

    return window;
  }

  isRunning(): boolean {
    return Boolean(this.browserWindow && !this.browserWindow.isDestroyed());
  }

  async close(): Promise<void> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      const closingWindow = this.browserWindow;
      this.browserWindow = null;
      closingWindow.destroy();
    }
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const window = await this.launch();
    return {
      url: window.webContents.getURL(),
      title: window.webContents.getTitle(),
    };
  }

  async getBrowserWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      return null;
    }

    return this.browserWindow.getBounds();
  }

  async takeScreenshot(): Promise<string> {
    const window = await this.launch();
    const image = await window.webContents.capturePage();
    return image.toPNG().toString('base64');
  }

  async captureBrowserSnapshot(): Promise<BrowserSnapshot> {
    const window = await this.launch();
    const [screenshot, pageContext] = await Promise.all([
      this.takeScreenshot(),
      this.extractPageContext(window),
    ]);

    return {
      sourceMode: this.controlMode,
      screenshot,
      pageUrl: window.webContents.getURL(),
      pageTitle: window.webContents.getTitle(),
      pageContext,
    };
  }

  async executeAction(action: GeminiAction): Promise<string> {
    const window = await this.launch();
    const contents = window.webContents;

    try {
      switch (action.type) {
        case 'navigate': {
          if (!action.url) return 'No URL provided';
          let url = action.url.trim();
          if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
          }

          const beforeUrl = contents.getURL();
          await this.ensurePageUrl(window, url);
          await this.waitForSettle('navigate');
          return contents.getURL() !== beforeUrl ? `Navigated to ${url}` : `Action failed: did not navigate to ${url}`;
        }

        case 'press': {
          const key = action.value?.trim() || 'Enter';
          await this.sendKeyPress(key);
          return `Pressed ${key}`;
        }

        case 'type': {
          const text = action.value || '';
          if (!text) return 'No text to type';
          await this.sendText(text);
          return `Typed "${text}" via keyboard`;
        }

        case 'scroll': {
          await contents.executeJavaScript('window.scrollBy({ top: Math.max(window.innerHeight * 0.7, 420), behavior: "smooth" });', true);
          return 'Scrolled down';
        }

        case 'scroll_up': {
          await contents.executeJavaScript('window.scrollBy({ top: -Math.max(window.innerHeight * 0.7, 420), behavior: "smooth" });', true);
          return 'Scrolled up';
        }

        case 'back': {
          const beforeUrl = contents.getURL();
          if (!contents.canGoBack()) {
            return 'Cannot go back, no previous page';
          }
          contents.goBack();
          await this.waitForSettle('back');
          const afterUrl = contents.getURL();
          return afterUrl && afterUrl !== beforeUrl ? 'Went back to previous page' : 'Cannot go back, no previous page';
        }

        case 'wait': {
          const ms = Math.min(parseInt(action.value || '2000', 10) || 2000, 5000);
          await new Promise((resolve) => setTimeout(resolve, ms));
          return `Waited ${ms}ms`;
        }

        case 'click':
        case 'fill':
        case 'select':
        case 'hover':
        case 'focus':
        case 'check':
        case 'uncheck': {
          const result = await this.runDomAction(action);
          return result.ok ? result.message : this.mapDomFailure(action, result.message);
        }

        default:
          return `Unknown action type: ${action.type}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BrowserService] Action failed:', message);
      return `Action failed: ${message}`;
    }
  }

  async waitForSettle(actionType: string): Promise<void> {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      return;
    }

    const contents = this.browserWindow.webContents;
    const needsLongerWait = ['navigate', 'click', 'back', 'select'].includes(actionType);
    const timeoutMs = needsLongerWait ? MAX_SETTLE_DELAY_MS : MIN_SETTLE_DELAY_MS;

    await Promise.race([
      new Promise<void>((resolve) => {
        if (!contents.isLoading()) {
          resolve();
          return;
        }

        const done = () => {
          contents.removeListener('did-stop-loading', done);
          contents.removeListener('did-fail-load', done);
          resolve();
        };

        contents.once('did-stop-loading', done);
        contents.once('did-fail-load', done);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    await new Promise((resolve) => setTimeout(resolve, MIN_SETTLE_DELAY_MS));
  }

  private async ensureWindow(initialUrl?: string): Promise<BrowserWindow> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      return this.browserWindow;
    }

    const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const width = Math.min(1320, Math.max(960, targetDisplay.workArea.width - 80));
    const height = Math.min(940, Math.max(720, targetDisplay.workArea.height - 80));
    const x = targetDisplay.workArea.x + Math.round((targetDisplay.workArea.width - width) / 2);
    const y = targetDisplay.workArea.y + Math.round((targetDisplay.workArea.height - height) / 2);

    const window = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 960,
      minHeight: 700,
      title: 'Sally Browser',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        partition: BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      void this.ensurePageUrl(window, url);
      return { action: 'deny' };
    });

    window.webContents.on('did-create-window', (childWindow) => {
      childWindow.close();
    });

    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.show();
      }
    });

    window.on('closed', () => {
      if (this.browserWindow === window) {
        this.browserWindow = null;
      }
    });

    this.browserWindow = window;
    this.launchNotice = 'Opening Sally browser for this task.';
    await this.ensurePageUrl(window, initialUrl || 'https://www.google.com');
    return window;
  }

  private hasRealContent(url: string): boolean {
    return Boolean(url && url !== 'about:blank' && !url.startsWith('chrome://newtab'));
  }

  private async ensurePageUrl(window: BrowserWindow, url: string): Promise<void> {
    const currentUrl = window.webContents.getURL();
    if (currentUrl === url) {
      return;
    }

    await window.loadURL(url);
  }

  private async extractPageContext(window: BrowserWindow): Promise<PageContext> {
    return this.executeInPage(window, extractPageContextInPage, {
      maxInteractiveElements: MAX_INTERACTIVE_ELEMENTS,
      maxVisibleMessages: MAX_VISIBLE_MESSAGES,
      maxHeadings: MAX_HEADINGS,
    });
  }

  private async runDomAction(action: GeminiAction): Promise<{ ok: boolean; message: string }> {
    const window = await this.launch();
    const result = await this.executeInPage(window, runDomActionInPage, { action });
    return result;
  }

  private async executeInPage<T, A>(window: BrowserWindow, fn: (args: A) => T, args: A): Promise<T> {
    const script = `(${fn.toString()})(${JSON.stringify(args)})`;
    return window.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  private async sendKeyPress(keyCode: string): Promise<void> {
    const window = await this.launch();
    window.focus();
    const contents = window.webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode.length === 1) {
      contents.sendInputEvent({ type: 'char', keyCode });
    }
    contents.sendInputEvent({ type: 'keyUp', keyCode });
  }

  private async sendText(text: string): Promise<void> {
    const window = await this.launch();
    window.focus();
    const contents = window.webContents;
    for (const char of text) {
      contents.sendInputEvent({ type: 'char', keyCode: char });
    }
  }

  private mapDomFailure(action: GeminiAction, message: string): string {
    switch (message) {
      case 'target_not_found':
        return action.selector ? `Could not find "${action.selector}"` : 'Could not find a matching control';
      case 'target_not_fillable':
        return action.selector ? `Could not type into "${action.selector}"` : 'Could not type into that field';
      case 'target_not_selectable':
        return action.selector ? `Could not select in "${action.selector}"` : 'Could not select that control';
      case 'option_not_found':
        return action.selector ? `Could not select in "${action.selector}"` : 'Could not find that option';
      default:
        return `Action failed: ${message}`;
    }
  }
}

export const browserService = new BrowserService();
