/// <reference lib="dom" />

import { BrowserWindow, screen, type WebContents, WebContentsView } from 'electron';
import type { BrowserUiState, BrowserTabState as BrowserShellTabState } from '../../../shared/types.js';
import { windowManager } from '../windowManager.js';
import { BROWSER_WINDOW } from '../utils/constants.js';
import type { GeminiAction } from './geminiService.js';
import { cloudLog } from './cloudLogger.js';
import type { BrowserSnapshot, BrowserSourceMode, BrowserTabInfo, PageContext } from './pageContext.js';
import { runDomTaskInPage } from './browserDomRuntime.js';
import { destinationResolver } from './destinationResolver.js';

const BROWSER_PARTITION = 'persist:sally-browser';
const MAX_INTERACTIVE_ELEMENTS = 40;
const MAX_VISIBLE_MESSAGES = 8;
const MAX_HEADINGS = 8;
const MIN_SETTLE_DELAY_MS = 600;
const MAX_SETTLE_DELAY_MS = 3_000;
const DEFAULT_START_URL = 'https://www.google.com';

interface BrowserTabRuntime {
  id: string;
  view: WebContentsView;
  createdAt: number;
  cleanup: () => void;
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
  private tabs: BrowserTabRuntime[] = [];
  private activeTabId: string | null = null;
  private launchNotice: string | null = null;
  private controlMode: BrowserSourceMode = 'electron_browser';
  private nextTabOrdinal = 1;
  private shellWindow: BrowserWindow | null = null;

  private readonly handleShellResize = (): void => {
    this.layoutActiveTabView();
  };

  private readonly handleShellClosed = (): void => {
    this.shellWindow = null;
    this.destroyAllTabs();
  };

  getSourceMode(): BrowserSourceMode {
    return this.controlMode;
  }

  consumeLaunchNotice(): string | null {
    const notice = this.launchNotice;
    this.launchNotice = null;
    return notice;
  }

  async launch(startUrl?: string): Promise<BrowserWindow> {
    const shell = this.ensureShellWindow();
    let tab = this.getActiveTab();
    const reusedExistingTab = Boolean(tab);

    if (!tab) {
      this.launchNotice = 'Opening Sally browser for this task.';
      tab = await this.createTab(startUrl || DEFAULT_START_URL, true);
    } else {
      if (startUrl) {
        await this.navigateTab(tab, startUrl);
      } else if (!this.hasRealContent(tab.view.webContents.getURL())) {
        await this.navigateTab(tab, DEFAULT_START_URL);
      }
      await this.showTab(tab.id);
    }

    if (!reusedExistingTab || startUrl) {
      cloudLog('INFO', 'browser_task_start', {
        startUrl: startUrl || null,
        reusedExistingTab,
        activeTabId: tab.id,
        pageUrl: tab.view.webContents.getURL() || null,
        pageTitle: tab.view.webContents.getTitle() || null,
      });
    }

    this.pushUiState();
    return shell;
  }

  isRunning(): boolean {
    this.cleanupDeadTabs();
    return this.tabs.length > 0;
  }

  async close(): Promise<void> {
    this.destroyAllTabs();
    this.activeTabId = null;
    this.pushUiState();
  }

  getUiState(): BrowserUiState {
    this.cleanupDeadTabs();
    const activeTab = this.getActiveTab();
    return {
      tabs: this.tabs.map((tab) => this.toShellTabState(tab)),
      activeTabId: this.activeTabId,
      activeTitle: activeTab?.view.webContents.getTitle() || '',
      activeUrl: activeTab?.view.webContents.getURL() || '',
      isLoading: activeTab?.view.webContents.isLoading() || false,
      canGoBack: activeTab?.view.webContents.canGoBack() || false,
      canGoForward: activeTab?.view.webContents.canGoForward() || false,
    };
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    return {
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
    };
  }

  listTabs(): BrowserTabInfo[] {
    this.cleanupDeadTabs();
    return this.tabs.map((tab) => this.toTabInfo(tab));
  }

  async openTab(url?: string, options: { activate?: boolean } = {}): Promise<BrowserTabInfo> {
    const tab = await this.createTab(url || DEFAULT_START_URL, options.activate !== false);
    this.pushUiState();
    return this.toTabInfo(tab);
  }

  async switchToTab(tabId: string): Promise<BrowserTabInfo | null> {
    const tab = this.tabs.find((entry) => entry.id === tabId) || null;
    if (!tab) {
      return null;
    }

    await this.showTab(tabId);
    return this.toTabInfo(tab);
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    const wasActive = this.activeTabId === tabId;
    this.detachTabView(tab);
    this.tabs = this.tabs.filter((entry) => entry.id !== tabId);
    tab.cleanup();
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }

    if (this.tabs.length === 0) {
      await this.createTab(DEFAULT_START_URL, true);
      return;
    }

    if (wasActive) {
      const fallback = this.tabs[this.tabs.length - 1];
      await this.showTab(fallback.id);
      return;
    }

    this.pushUiState();
  }

  async navigateActiveTab(url: string): Promise<void> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    await this.navigateTab(tab, url);
    this.pushUiState();
  }

  async goBack(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !tab.view.webContents.canGoBack()) {
      return;
    }

    tab.view.webContents.goBack();
    await this.waitForSettle('back');
    this.pushUiState();
  }

  async goForward(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || !tab.view.webContents.canGoForward()) {
      return;
    }

    tab.view.webContents.goForward();
    await this.waitForSettle('navigate');
    this.pushUiState();
  }

  async reloadActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) {
      return;
    }

    tab.view.webContents.reload();
    await this.waitForSettle('navigate');
    this.pushUiState();
  }

  async getBrowserWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const shell = this.shellWindow;
    if (!shell || shell.isDestroyed()) {
      return null;
    }

    return shell.getBounds();
  }

  async getBrowserContentBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const shell = this.shellWindow;
    if (!shell || shell.isDestroyed()) {
      return null;
    }

    const contentBounds = shell.getContentBounds();
    return {
      x: contentBounds.x,
      y: contentBounds.y + BROWSER_WINDOW.chromeHeight,
      width: contentBounds.width,
      height: Math.max(0, contentBounds.height - BROWSER_WINDOW.chromeHeight),
    };
  }

  async takeScreenshot(): Promise<string> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    const image = await tab.view.webContents.capturePage();
    return image.toPNG().toString('base64');
  }

  async captureBrowserSnapshot(): Promise<BrowserSnapshot> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    const [screenshot, pageContext] = await Promise.all([
      this.takeScreenshot(),
      this.extractPageContext(tab.view.webContents),
    ]);

    return {
      sourceMode: this.controlMode,
      screenshot,
      pageUrl: tab.view.webContents.getURL(),
      pageTitle: tab.view.webContents.getTitle(),
      pageContext,
      tabs: this.listTabs(),
      activeTabId: this.activeTabId,
    };
  }

  async inspectGmailDraft(): Promise<GmailDraftInspection | null> {
    const tab = this.getActiveTab();
    if (!tab || tab.view.webContents.isDestroyed()) {
      return null;
    }

    const currentUrl = tab.view.webContents.getURL();
    if (!currentUrl.includes('mail.google.com')) {
      return null;
    }

    return tab.view.webContents.executeJavaScript(`(() => {
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
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    const contents = tab.view.webContents;
    const startedAt = Date.now();

    try {
      let result: string;

      switch (action.type) {
        case 'navigate': {
          if (!action.url) {
            result = 'No URL provided';
            break;
          }
          const url = await this.resolveNavigationTarget(action.url);
          const beforeUrl = contents.getURL();
          await this.ensurePageUrl(contents, url);
          const afterUrl = await this.waitForNavigationResult(contents, beforeUrl, url);
          result = afterUrl && (afterUrl !== beforeUrl || this.isEquivalentNavigationUrl(afterUrl, url))
            ? `Navigated to ${afterUrl}`
            : `Action failed: did not navigate to ${url}`;
          break;
        }

        case 'open_tab': {
          const rawUrl = action.url || action.selector || action.value || '';
          const targetUrl = rawUrl ? await this.resolveNavigationTarget(rawUrl) : undefined;
          const created = await this.openTab(targetUrl, { activate: true });
          await this.waitForSettle('open_tab');
          result = `Opened new tab "${created.title || created.url}"`;
          break;
        }

        case 'switch_tab': {
          const resolved = await this.switchTab(action);
          if (!resolved) {
            result = 'Action failed: could not find a matching tab';
            break;
          }
          await this.waitForSettle('switch_tab');
          result = `Switched to tab "${resolved.title || resolved.url}"`;
          break;
        }

        case 'press': {
          const key = action.value?.trim() || 'Enter';
          await this.sendKeyPress(key);
          result = `Pressed ${key}`;
          break;
        }

        case 'type': {
          const text = action.value || '';
          if (!text) {
            result = 'No text to type';
            break;
          }
          await this.sendText(text);
          result = `Typed "${text}" via keyboard`;
          break;
        }

        case 'scroll': {
          await contents.executeJavaScript('window.scrollBy({ top: Math.max(window.innerHeight * 0.7, 420), behavior: "smooth" });', true);
          result = 'Scrolled down';
          break;
        }

        case 'scroll_up': {
          await contents.executeJavaScript('window.scrollBy({ top: -Math.max(window.innerHeight * 0.7, 420), behavior: "smooth" });', true);
          result = 'Scrolled up';
          break;
        }

        case 'back': {
          const beforeUrl = contents.getURL();
          if (!contents.canGoBack()) {
            result = 'Cannot go back, no previous page';
            break;
          }
          contents.goBack();
          await this.waitForSettle('back');
          const afterUrl = contents.getURL();
          result = afterUrl && afterUrl !== beforeUrl ? 'Went back to previous page' : 'Cannot go back, no previous page';
          break;
        }

        case 'wait': {
          const ms = Math.min(parseInt(action.value || '2000', 10) || 2000, 5000);
          await new Promise((resolve) => setTimeout(resolve, ms));
          result = `Waited ${ms}ms`;
          break;
        }

        case 'click':
        case 'fill':
        case 'select':
        case 'hover':
        case 'focus':
        case 'check':
        case 'uncheck': {
          const domResult = await this.runDomAction(action);
          const verified = action.type === 'click'
            ? await this.verifyOrRecoverDomClick(action, domResult)
            : domResult;
          const message = verified.ok ? verified.message : this.mapDomFailure(action, verified.message);
          cloudLog(verified.ok ? 'INFO' : 'WARNING', 'browser_action_iteration', {
            actionType: action.type,
            selector: action.selector || null,
            targetId: action.targetId || null,
            framePath: action.framePath || null,
            shadowPath: action.shadowPath || null,
            latencyMs: Date.now() - startedAt,
            success: verified.ok,
            result: message,
          });
          this.pushUiState();
          return message;
        }

        default:
          result = `Unknown action type: ${action.type}`;
          break;
      }

      cloudLog(
        result.startsWith('Action failed') || result.startsWith('Cannot') || result.startsWith('Unknown') || result.startsWith('No ')
          ? 'WARNING'
          : 'INFO',
        'browser_action_iteration',
        {
          actionType: action.type,
          selector: action.selector || null,
          targetId: action.targetId || null,
          url: action.url || null,
          valueLength: typeof action.value === 'string' ? action.value.length : null,
          tabId: action.tabId || null,
          latencyMs: Date.now() - startedAt,
          success: !(result.startsWith('Action failed') || result.startsWith('Cannot') || result.startsWith('Unknown') || result.startsWith('No ')),
          result,
        },
      );

      this.pushUiState();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BrowserService] Action failed:', message);
      cloudLog('ERROR', 'browser_action_iteration', {
        actionType: action.type,
        selector: action.selector || null,
        targetId: action.targetId || null,
        url: action.url || null,
        tabId: action.tabId || null,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: message,
      });
      this.pushUiState();
      return `Action failed: ${message}`;
    }
  }

  async waitForSettle(actionType: string): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || tab.view.webContents.isDestroyed()) {
      return;
    }

    const contents = tab.view.webContents;
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
    this.pushUiState();
  }

  private ensureShellWindow(): BrowserWindow {
    const shell = windowManager.showBrowserWindow();
    if (this.shellWindow?.id === shell.id) {
      return shell;
    }

    if (this.shellWindow && !this.shellWindow.isDestroyed()) {
      this.shellWindow.off('resize', this.handleShellResize);
      this.shellWindow.off('closed', this.handleShellClosed);
    }

    this.shellWindow = shell;
    shell.on('resize', this.handleShellResize);
    shell.on('closed', this.handleShellClosed);
    shell.webContents.on('did-finish-load', () => {
      this.layoutActiveTabView();
      this.pushUiState();
    });
    this.layoutActiveTabView();
    this.pushUiState();
    return shell;
  }

  private toShellTabState(tab: BrowserTabRuntime): BrowserShellTabState {
    const contents = tab.view.webContents;
    return {
      id: tab.id,
      title: contents.getTitle(),
      url: contents.getURL(),
      isActive: tab.id === this.activeTabId,
      isLoading: contents.isLoading(),
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
    };
  }

  private pushUiState(): void {
    const state = this.getUiState();
    const shell = this.shellWindow;
    let activeTitle = state.activeTitle;

    if (!activeTitle && state.activeUrl) {
      try {
        activeTitle = new URL(state.activeUrl).hostname;
      } catch {
        activeTitle = state.activeUrl;
      }
    }

    if (shell && !shell.isDestroyed()) {
      shell.setTitle(activeTitle ? `${activeTitle} - Sally Browser` : 'Sally Browser');
    }
    windowManager.broadcastToAll('browser:state-changed', state);
  }

  private getActiveTab(): BrowserTabRuntime | null {
    this.cleanupDeadTabs();
    if (this.activeTabId) {
      const active = this.tabs.find((tab) => tab.id === this.activeTabId);
      if (active) {
        return active;
      }
    }

    const fallback = this.tabs[0] || null;
    this.activeTabId = fallback?.id || null;
    return fallback;
  }

  private cleanupDeadTabs(): void {
    this.tabs = this.tabs.filter((tab) => !tab.view.webContents.isDestroyed());
    if (this.activeTabId && !this.tabs.some((tab) => tab.id === this.activeTabId)) {
      this.activeTabId = this.tabs[0]?.id || null;
    }
  }

  private layoutActiveTabView(): void {
    const shell = this.shellWindow;
    const active = this.getActiveTab();
    if (!shell || shell.isDestroyed() || !active) {
      return;
    }

    active.view.setBounds(this.getActiveViewBounds(shell));
    active.view.setVisible(true);
  }

  private getActiveViewBounds(shell: BrowserWindow): { x: number; y: number; width: number; height: number } {
    const contentBounds = shell.getContentBounds();
    return {
      x: 0,
      y: BROWSER_WINDOW.chromeHeight,
      width: contentBounds.width,
      height: Math.max(0, contentBounds.height - BROWSER_WINDOW.chromeHeight),
    };
  }

  private attachTabView(tab: BrowserTabRuntime): void {
    const shell = this.ensureShellWindow();
    for (const entry of this.tabs) {
      if (entry.id === tab.id) {
        continue;
      }
      this.detachTabView(entry);
      entry.view.setVisible(false);
    }

    tab.view.setBounds(this.getActiveViewBounds(shell));
    tab.view.setVisible(true);
    shell.contentView.addChildView(tab.view);
    shell.show();
    shell.focus();
    tab.view.webContents.focus();
  }

  private detachTabView(tab: BrowserTabRuntime): void {
    const shell = this.shellWindow;
    if (!shell || shell.isDestroyed()) {
      return;
    }

    tab.view.setVisible(false);
    shell.contentView.removeChildView(tab.view);
  }

  private async showTab(tabId: string): Promise<void> {
    this.cleanupDeadTabs();
    const next = this.tabs.find((tab) => tab.id === tabId);
    if (!next) {
      return;
    }

    this.activeTabId = next.id;
    this.attachTabView(next);
    this.pushUiState();
  }

  private destroyAllTabs(): void {
    const tabs = [...this.tabs];
    this.tabs = [];
    this.activeTabId = null;
    for (const tab of tabs) {
      this.detachTabView(tab);
      tab.cleanup();
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    }
  }

  private attachTabListeners(tab: BrowserTabRuntime): void {
    const contents = tab.view.webContents;
    const sync = (): void => {
      if (this.activeTabId === tab.id) {
        this.layoutActiveTabView();
      }
      this.pushUiState();
    };

    contents.setWindowOpenHandler(({ url }) => {
      void this.openTab(url, { activate: true });
      return { action: 'deny' };
    });

    const listeners: Array<[string, (...args: unknown[]) => void]> = [
      ['did-start-loading', sync],
      ['did-stop-loading', sync],
      ['did-fail-load', sync],
      ['page-title-updated', sync],
      ['did-navigate', sync],
      ['did-navigate-in-page', sync],
      ['dom-ready', sync],
      ['destroyed', () => this.handleDestroyedTab(tab.id)],
    ];

    for (const [eventName, handler] of listeners) {
      contents.on(eventName as Parameters<WebContents['on']>[0], handler as Parameters<WebContents['on']>[1]);
    }

    tab.cleanup = () => {
      for (const [eventName, handler] of listeners) {
        contents.removeListener(eventName as Parameters<WebContents['on']>[0], handler as Parameters<WebContents['on']>[1]);
      }
    };
  }

  private handleDestroyedTab(tabId: string): void {
    this.tabs = this.tabs.filter((tab) => tab.id !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[0]?.id || null;
      const next = this.getActiveTab();
      if (next) {
        this.attachTabView(next);
      }
    }
    this.pushUiState();
  }

  private async createTab(initialUrl: string, activate: boolean): Promise<BrowserTabRuntime> {
    this.ensureShellWindow();
    const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#ffffff');

    const tab: BrowserTabRuntime = {
      id: `tab-${this.nextTabOrdinal++}`,
      view,
      createdAt: Date.now(),
      cleanup: () => undefined,
    };

    this.attachTabListeners(tab);
    this.tabs.push(tab);

    const x = targetDisplay.workArea.x + Math.round((targetDisplay.workArea.width - BROWSER_WINDOW.width) / 2);
    const y = targetDisplay.workArea.y + Math.round((targetDisplay.workArea.height - BROWSER_WINDOW.height) / 2);
    const shell = this.ensureShellWindow();
    if (!shell.isVisible()) {
      shell.setBounds({
        x,
        y,
        width: Math.min(BROWSER_WINDOW.width, targetDisplay.workArea.width),
        height: Math.min(BROWSER_WINDOW.height, targetDisplay.workArea.height),
      });
    }

    await this.ensurePageUrl(tab.view.webContents, this.coerceUrl(initialUrl));

    if (activate || !this.activeTabId) {
      await this.showTab(tab.id);
    } else {
      this.pushUiState();
    }

    return tab;
  }

  private async navigateTab(tab: BrowserTabRuntime, target: string): Promise<void> {
    await this.ensurePageUrl(tab.view.webContents, await this.resolveNavigationTarget(target));
    if (this.activeTabId === tab.id) {
      this.pushUiState();
    }
  }

  private toTabInfo(tab: BrowserTabRuntime): BrowserTabInfo {
    return {
      id: tab.id,
      title: tab.view.webContents.getTitle(),
      url: tab.view.webContents.getURL(),
      isActive: tab.id === this.activeTabId,
    };
  }

  private async switchTab(action: GeminiAction): Promise<BrowserTabInfo | null> {
    const tab = this.resolveTab(action);
    if (!tab) {
      return null;
    }

    await this.showTab(tab.id);
    return this.toTabInfo(tab);
  }

  private resolveTab(action: GeminiAction): BrowserTabRuntime | null {
    const tabs = [...this.tabs];
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

    const scoreTab = (tab: BrowserTabRuntime): number => {
      const title = tab.view.webContents.getTitle().toLowerCase();
      const url = tab.view.webContents.getURL().toLowerCase();
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

  private hasRealContent(url: string): boolean {
    return Boolean(url && url !== 'about:blank' && !url.startsWith('chrome://newtab'));
  }

  private async resolveNavigationTarget(target: string): Promise<string> {
    const trimmed = target.trim();
    if (!trimmed) {
      return DEFAULT_START_URL;
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

  private async waitForNavigationResult(contents: WebContents, beforeUrl: string, targetUrl: string): Promise<string> {
    await this.waitForSettle('navigate');

    const deadline = Date.now() + 8_000;
    let currentUrl = contents.getURL();

    while (Date.now() < deadline) {
      if (currentUrl && currentUrl !== beforeUrl) {
        return currentUrl;
      }

      if (this.isEquivalentNavigationUrl(currentUrl, targetUrl)) {
        return currentUrl;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      currentUrl = contents.getURL();
    }

    return currentUrl;
  }

  private coerceUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
      return DEFAULT_START_URL;
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }

  private async ensurePageUrl(contents: WebContents, url: string): Promise<void> {
    const currentUrl = contents.getURL();
    if (currentUrl === url) {
      return;
    }

    await contents.loadURL(url);
  }

  private async extractPageContext(contents: WebContents): Promise<PageContext> {
    return this.executeInPage(contents, runDomTaskInPage, {
      mode: 'snapshot',
      options: {
        maxInteractiveElements: MAX_INTERACTIVE_ELEMENTS,
        maxVisibleMessages: MAX_VISIBLE_MESSAGES,
        maxHeadings: MAX_HEADINGS,
      },
    }) as Promise<PageContext>;
  }

  private async runDomAction(action: GeminiAction): Promise<{ ok: boolean; message: string }> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    return this.executeInPage(tab.view.webContents, runDomTaskInPage, {
      mode: 'action',
      action,
    }) as Promise<{ ok: boolean; message: string }>;
  }

  private async executeInPage<T, A>(contents: WebContents, fn: (args: A) => T, args: A): Promise<T> {
    const script = `(${fn.toString()})(${JSON.stringify(args)})`;
    return contents.executeJavaScript(script, true) as Promise<T>;
  }

  private async sendKeyPress(keyCode: string): Promise<void> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    const contents = tab.view.webContents;
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode.length === 1) {
      contents.sendInputEvent({ type: 'char', keyCode });
    }
    contents.sendInputEvent({ type: 'keyUp', keyCode });
  }

  private async sendText(text: string): Promise<void> {
    const tab = this.getActiveTab() || await this.createTab(DEFAULT_START_URL, true);
    const contents = tab.view.webContents;
    contents.focus();
    for (const char of text) {
      contents.sendInputEvent({ type: 'char', keyCode: char });
    }
  }

  private isGmailComposeAction(action: GeminiAction, currentUrl: string): boolean {
    if (action.type !== 'click' || !currentUrl.includes('mail.google.com')) {
      return false;
    }

    const texts = [action.selector, action.value]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .join(' ');
    return /\b(compose|new email|new message)\b/i.test(texts);
  }

  private async inspectGmailDraftWithRetry(attempts = 4, intervalMs = 250): Promise<GmailDraftInspection | null> {
    let lastDraft: GmailDraftInspection | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      lastDraft = await this.inspectGmailDraft();
      if (lastDraft?.composeOpen) {
        return lastDraft;
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return lastDraft;
  }

  private async tryGmailComposeButtonFallback(contents: WebContents): Promise<boolean> {
    return contents.executeJavaScript(`(() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity || '1') <= 0.05) return false;
        return rect.width >= 4 && rect.height >= 4 && rect.bottom >= 0 && rect.right >= 0;
      };

      const candidates = Array.from(document.querySelectorAll('div[role="button"], button, [gh="cm"], [aria-label], [data-tooltip]'))
        .filter((element) => element instanceof HTMLElement)
        .filter((element) => isVisible(element))
        .map((element) => {
          const label = normalize(
            element.getAttribute('aria-label')
            || element.getAttribute('data-tooltip')
            || element.getAttribute('title')
            || element.textContent
          );
          const gh = normalize(element.getAttribute('gh'));
          const score = (
            (gh === 'cm' ? 220 : 0)
            + (label === 'compose' ? 180 : 0)
            + (label.startsWith('compose') ? 120 : 0)
            + (label.includes('new message') ? 110 : 0)
            + (element.getAttribute('role') === 'button' ? 30 : 0)
            + (element.tagName.toLowerCase() === 'button' ? 20 : 0)
          );
          return { element, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);

      const target = candidates[0]?.element;
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      target.focus();
      const rect = target.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };

      target.dispatchEvent(new PointerEvent('pointerdown', eventInit));
      target.dispatchEvent(new MouseEvent('mousedown', eventInit));
      target.dispatchEvent(new PointerEvent('pointerup', eventInit));
      target.dispatchEvent(new MouseEvent('mouseup', eventInit));
      target.click();
      return true;
    })()`, true) as Promise<boolean>;
  }

  private async verifyOrRecoverDomClick(
    action: GeminiAction,
    domResult: { ok: boolean; message: string },
  ): Promise<{ ok: boolean; message: string }> {
    const tab = this.getActiveTab();
    if (!tab) {
      return domResult;
    }

    const currentUrl = tab.view.webContents.getURL();
    if (!this.isGmailComposeAction(action, currentUrl)) {
      return domResult;
    }

    const initialDraftState = await this.inspectGmailDraftWithRetry();
    if (initialDraftState?.composeOpen) {
      return domResult.ok
        ? domResult
        : { ok: true, message: 'Opened Gmail compose' };
    }

    const fallbackTriggered = await this.tryGmailComposeButtonFallback(tab.view.webContents);
    if (fallbackTriggered) {
      const recoveredDraftState = await this.inspectGmailDraftWithRetry();
      if (recoveredDraftState?.composeOpen) {
        return { ok: true, message: 'Opened Gmail compose' };
      }
    }

    return { ok: false, message: 'gmail_compose_not_opened' };
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
      case 'gmail_compose_not_opened':
        return 'Could not open Gmail compose';
      default:
        return `Action failed: ${message}`;
    }
  }
}

export const browserService = new BrowserService();
