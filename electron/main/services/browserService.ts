/// <reference lib="dom" />

import { BrowserWindow, screen } from 'electron';
import type { GeminiAction } from './geminiService.js';
import type { BrowserSnapshot, BrowserSourceMode, BrowserTabInfo, PageContext } from './pageContext.js';
import { runDomTaskInPage } from './browserDomRuntime.js';
import { destinationResolver } from './destinationResolver.js';

const BROWSER_PARTITION = 'persist:sally-browser';
const MAX_INTERACTIVE_ELEMENTS = 40;
const MAX_VISIBLE_MESSAGES = 8;
const MAX_HEADINGS = 8;
const MIN_SETTLE_DELAY_MS = 600;
const MAX_SETTLE_DELAY_MS = 3_000;

interface BrowserTabState {
  id: string;
  window: BrowserWindow;
  createdAt: number;
}

export interface GmailDraftInspection {
  url: string;
  title: string;
  composeOpen: boolean;
  toValue: string | null;
  subject: string | null;
  bodyText: string;
  sendVisible: boolean;
}

class BrowserService {
  private tabs: BrowserTabState[] = [];
  private activeTabId: string | null = null;
  private launchNotice: string | null = null;
  private controlMode: BrowserSourceMode = 'electron_browser';
  private nextTabOrdinal = 1;

  getSourceMode(): BrowserSourceMode {
    return this.controlMode;
  }

  consumeLaunchNotice(): string | null {
    const notice = this.launchNotice;
    this.launchNotice = null;
    return notice;
  }

  async launch(startUrl?: string): Promise<BrowserWindow> {
    let tab = this.getActiveTab();
    if (!tab) {
      this.launchNotice = 'Opening Sally browser for this task.';
      tab = await this.createTab(startUrl || 'https://www.google.com', true);
    } else {
      if (startUrl) {
        await this.ensurePageUrl(tab.window, this.coerceUrl(startUrl));
      } else if (!this.hasRealContent(tab.window.webContents.getURL())) {
        await this.ensurePageUrl(tab.window, 'https://www.google.com');
      }
      await this.showTab(tab.id);
    }

    return tab.window;
  }

  isRunning(): boolean {
    this.cleanupDeadTabs();
    return this.tabs.length > 0;
  }

  async close(): Promise<void> {
    const tabs = [...this.tabs];
    this.tabs = [];
    this.activeTabId = null;

    for (const tab of tabs) {
      if (!tab.window.isDestroyed()) {
        tab.window.destroy();
      }
    }
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const window = await this.launch();
    return {
      url: window.webContents.getURL(),
      title: window.webContents.getTitle(),
    };
  }

  listTabs(): BrowserTabInfo[] {
    this.cleanupDeadTabs();
    return this.tabs.map((tab) => this.toTabInfo(tab));
  }

  async getBrowserWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const tab = this.getActiveTab();
    if (!tab || tab.window.isDestroyed()) {
      return null;
    }

    return tab.window.getBounds();
  }

  async getBrowserContentBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const tab = this.getActiveTab();
    if (!tab || tab.window.isDestroyed()) {
      return null;
    }

    return tab.window.getContentBounds();
  }

  async takeScreenshot(): Promise<string> {
    const window = await this.launch();
    const image = await window.webContents.capturePage();
    return image.toPNG().toString('base64');
  }

  async captureBrowserSnapshot(): Promise<BrowserSnapshot> {
    const tab = this.getActiveTab() || { id: '', window: await this.launch(), createdAt: Date.now() };
    const [screenshot, pageContext] = await Promise.all([
      this.takeScreenshot(),
      this.extractPageContext(tab.window),
    ]);

    return {
      sourceMode: this.controlMode,
      screenshot,
      pageUrl: tab.window.webContents.getURL(),
      pageTitle: tab.window.webContents.getTitle(),
      pageContext,
      tabs: this.listTabs(),
      activeTabId: this.activeTabId,
    };
  }

  async inspectGmailDraft(): Promise<GmailDraftInspection | null> {
    const tab = this.getActiveTab();
    if (!tab || tab.window.isDestroyed()) {
      return null;
    }

    const currentUrl = tab.window.webContents.getURL();
    if (!currentUrl.includes('mail.google.com')) {
      return null;
    }

    return tab.window.webContents.executeJavaScript(`(() => {
      const url = new URL(location.href);
      const composeDialog = document.querySelector('div[role="dialog"]');
      const bodyRoot = document.querySelector('div[aria-label="Message Body"]')
        || document.querySelector('div[role="textbox"][aria-label*="Message Body"]');
      const subjectInput = document.querySelector('input[name="subjectbox"]');
      const toInput = document.querySelector('input[aria-label*="Recipients"]')
        || document.querySelector('input[aria-label*="To"]');
      const recipientChip = document.querySelector('[email]') || document.querySelector('span[email]');
      const sendButton = Array.from(document.querySelectorAll('div[role="button"], button'))
        .find((element) => {
          const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
          return /^send$/i.test(label) || /^send\\b/i.test(label);
        });

      return {
        url: location.href,
        title: document.title,
        composeOpen: Boolean(composeDialog || subjectInput || bodyRoot || url.searchParams.get('tf') === 'cm'),
        toValue: (toInput && 'value' in toInput ? toInput.value || null : null)
          || recipientChip?.getAttribute('email')
          || url.searchParams.get('to')
          || null,
        subject: subjectInput && 'value' in subjectInput ? subjectInput.value || null : null,
        bodyText: bodyRoot
          ? (bodyRoot.innerText || bodyRoot.textContent || '')
          : (url.searchParams.get('body') || ''),
        sendVisible: Boolean(sendButton),
      };
    })()`, true) as Promise<GmailDraftInspection>;
  }

  async executeAction(action: GeminiAction): Promise<string> {
    const window = await this.launch();
    const contents = window.webContents;

    try {
      switch (action.type) {
        case 'navigate': {
          if (!action.url) return 'No URL provided';
          const url = await this.resolveNavigationTarget(action.url);
          const beforeUrl = contents.getURL();
          await this.ensurePageUrl(window, url);
          const afterUrl = await this.waitForNavigationResult(window, beforeUrl, url);
          return afterUrl && (afterUrl !== beforeUrl || this.isEquivalentNavigationUrl(afterUrl, url))
            ? `Navigated to ${afterUrl}`
            : `Action failed: did not navigate to ${url}`;
        }

        case 'open_tab': {
          const rawUrl = action.url || action.selector || action.value || '';
          const targetUrl = rawUrl ? await this.resolveNavigationTarget(rawUrl) : undefined;
          const tab = await this.openTab(targetUrl, { activate: true });
          await this.waitForSettle('open_tab');
          return `Opened new tab "${tab.title || tab.url}"`;
        }

        case 'switch_tab': {
          const resolved = await this.switchTab(action);
          if (!resolved) {
            return 'Action failed: could not find a matching tab';
          }
          await this.waitForSettle('switch_tab');
          return `Switched to tab "${resolved.title || resolved.url}"`;
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
    const tab = this.getActiveTab();
    if (!tab || tab.window.isDestroyed()) {
      return;
    }

    const contents = tab.window.webContents;
    const needsLongerWait = ['navigate', 'click', 'back', 'select', 'open_tab', 'switch_tab'].includes(actionType);
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

  async openTab(url?: string, options: { activate?: boolean } = {}): Promise<BrowserTabInfo> {
    const tab = await this.createTab(url || 'https://www.google.com', options.activate !== false);
    return this.toTabInfo(tab);
  }

  private async switchTab(action: GeminiAction): Promise<BrowserTabInfo | null> {
    const tab = this.resolveTab(action);
    if (!tab) {
      return null;
    }

    await this.showTab(tab.id);
    return this.toTabInfo(tab);
  }

  private resolveTab(action: GeminiAction): BrowserTabState | null {
    const tabs = this.getLiveTabs();
    if (tabs.length === 0) {
      return null;
    }

    if (action.tabId) {
      const exact = tabs.find((tab) => tab.id === action.tabId);
      if (exact) {
        return exact;
      }
    }

    if (typeof action.index === 'number' && action.index > 0 && action.index <= tabs.length) {
      return tabs[action.index - 1] || null;
    }

    const query = [action.selector, action.value, action.url]
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim().toLowerCase())
      .join(' ');

    if (!query) {
      return this.getActiveTab();
    }

    const scoreTab = (tab: BrowserTabState): number => {
      const title = tab.window.webContents.getTitle().toLowerCase();
      const url = tab.window.webContents.getURL().toLowerCase();
      let score = 0;

      if (title === query || url === query) score = Math.max(score, 120);
      if (title.includes(query)) score = Math.max(score, 90);
      if (url.includes(query)) score = Math.max(score, 85);

      const queryTokens = query.split(/\s+/).filter(Boolean);
      const hitCount = queryTokens.filter((token) => title.includes(token) || url.includes(token)).length;
      if (hitCount > 0) {
        score = Math.max(score, 30 + hitCount * 10);
      }

      if (tab.id === this.activeTabId) {
        score -= 5;
      }

      return score;
    };

    return tabs
      .map((tab) => ({ tab, score: scoreTab(tab) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.tab.createdAt - right.tab.createdAt)[0]?.tab || null;
  }

  private async createTab(initialUrl: string, activate: boolean): Promise<BrowserTabState> {
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

    const tab: BrowserTabState = {
      id: `tab-${this.nextTabOrdinal++}`,
      window,
      createdAt: Date.now(),
    };

    window.webContents.setWindowOpenHandler(({ url }) => {
      void this.openTab(url, { activate: true });
      return { action: 'deny' };
    });

    window.webContents.on('did-create-window', (childWindow) => {
      childWindow.close();
    });

    window.on('focus', () => {
      if (this.tabs.some((entry) => entry.id === tab.id)) {
        this.activeTabId = tab.id;
      }
    });

    window.on('closed', () => {
      this.handleClosedTab(tab.id);
    });

    this.tabs.push(tab);
    await this.ensurePageUrl(window, this.coerceUrl(initialUrl));

    if (activate || !this.activeTabId) {
      await this.showTab(tab.id);
    } else {
      window.hide();
    }

    return tab;
  }

  private handleClosedTab(tabId: string): void {
    this.tabs = this.tabs.filter((tab) => tab.id !== tabId && !tab.window.isDestroyed());
    if (this.activeTabId === tabId) {
      const nextTab = this.tabs[0] || null;
      this.activeTabId = nextTab?.id || null;
      if (nextTab) {
        void this.showTab(nextTab.id);
      }
    }
  }

  private async showTab(tabId: string): Promise<void> {
    this.cleanupDeadTabs();
    const nextTab = this.tabs.find((tab) => tab.id === tabId);
    if (!nextTab || nextTab.window.isDestroyed()) {
      return;
    }

    for (const tab of this.tabs) {
      if (tab.window.isDestroyed()) {
        continue;
      }

      if (tab.id === tabId) {
        if (tab.window.isMinimized()) {
          tab.window.restore();
        }
        tab.window.show();
        tab.window.focus();
      } else {
        tab.window.hide();
      }
    }

    this.activeTabId = nextTab.id;
  }

  private getActiveTab(): BrowserTabState | null {
    this.cleanupDeadTabs();
    if (this.activeTabId) {
      const tab = this.tabs.find((entry) => entry.id === this.activeTabId);
      if (tab) {
        return tab;
      }
    }

    const fallback = this.tabs[0] || null;
    this.activeTabId = fallback?.id || null;
    return fallback;
  }

  private getLiveTabs(): BrowserTabState[] {
    this.cleanupDeadTabs();
    return [...this.tabs];
  }

  private cleanupDeadTabs(): void {
    this.tabs = this.tabs.filter((tab) => !tab.window.isDestroyed());
    if (this.activeTabId && !this.tabs.some((tab) => tab.id === this.activeTabId)) {
      this.activeTabId = this.tabs[0]?.id || null;
    }
  }

  private toTabInfo(tab: BrowserTabState): BrowserTabInfo {
    return {
      id: tab.id,
      title: tab.window.webContents.getTitle(),
      url: tab.window.webContents.getURL(),
      isActive: tab.id === this.activeTabId,
    };
  }

  private hasRealContent(url: string): boolean {
    return Boolean(url && url !== 'about:blank' && !url.startsWith('chrome://newtab'));
  }

  private async resolveNavigationTarget(target: string): Promise<string> {
    const trimmed = target.trim();
    if (!trimmed) {
      return 'https://www.google.com';
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i.test(trimmed)) {
      return this.coerceUrl(trimmed);
    }

    const resolved = await destinationResolver.resolveNavigationTarget(trimmed);
    return resolved.url;
  }

  private isEquivalentNavigationUrl(currentUrl: string, targetUrl: string): boolean {
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);

      if (current.origin === target.origin) {
        const normalizedTargetPath = target.pathname.replace(/\/+$/g, '') || '/';
        const normalizedCurrentPath = current.pathname.replace(/\/+$/g, '') || '/';
        if (normalizedTargetPath === '/') {
          return true;
        }

        return normalizedCurrentPath === normalizedTargetPath || normalizedCurrentPath.startsWith(`${normalizedTargetPath}/`);
      }

      if (target.hostname === 'mail.google.com') {
        if (current.hostname === 'workspace.google.com' && /\/gmail\/?$/i.test(current.pathname.replace(/\/+$/g, ''))) {
          return true;
        }

        if (current.hostname === 'accounts.google.com') {
          const continueTarget = current.searchParams.get('continue') || '';
          const service = current.searchParams.get('service') || '';
          return continueTarget.includes('mail.google.com') || /mail/i.test(service);
        }
      }

      return false;
    } catch {
      return currentUrl === targetUrl || currentUrl.startsWith(targetUrl);
    }
  }

  private async waitForNavigationResult(window: BrowserWindow, beforeUrl: string, targetUrl: string): Promise<string> {
    await this.waitForSettle('navigate');

    const deadline = Date.now() + 8_000;
    let currentUrl = window.webContents.getURL();

    while (Date.now() < deadline) {
      if (currentUrl && currentUrl !== beforeUrl) {
        return currentUrl;
      }

      if (this.isEquivalentNavigationUrl(currentUrl, targetUrl)) {
        return currentUrl;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      currentUrl = window.webContents.getURL();
    }

    return currentUrl;
  }

  private coerceUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
      return 'https://www.google.com';
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }

  private async ensurePageUrl(window: BrowserWindow, url: string): Promise<void> {
    const currentUrl = window.webContents.getURL();
    if (currentUrl === url) {
      return;
    }

    await window.loadURL(url);
  }

  private async extractPageContext(window: BrowserWindow): Promise<PageContext> {
    return this.executeInPage(window, runDomTaskInPage, {
      mode: 'snapshot',
      options: {
        maxInteractiveElements: MAX_INTERACTIVE_ELEMENTS,
        maxVisibleMessages: MAX_VISIBLE_MESSAGES,
        maxHeadings: MAX_HEADINGS,
      },
    }) as Promise<PageContext>;
  }

  private async runDomAction(action: GeminiAction): Promise<{ ok: boolean; message: string }> {
    const window = await this.launch();
    return this.executeInPage(window, runDomTaskInPage, {
      mode: 'action',
      action,
    }) as Promise<{ ok: boolean; message: string }>;
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
