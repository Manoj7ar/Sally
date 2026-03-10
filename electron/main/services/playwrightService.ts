// Playwright browser automation service — uses the user's real Chrome profile
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type BrowserContext, type Page, type Locator } from 'playwright-core';
import type { GeminiAction } from './geminiService.js';
import { findBrowserLaunchTarget } from '../utils/browserDiscovery.js';

const ACTION_TIMEOUT_MS = 10_000;
const MAX_SELECTOR_LENGTH = 500;

class PlaywrightService {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private ephemeralUserDataDir: string | null = null;

  async launch(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const browserTarget = findBrowserLaunchTarget();
    if (!browserTarget) {
      throw new Error('No supported browser installation found. Install Google Chrome, Chromium, or Microsoft Edge.');
    }

    const userDataDir = browserTarget.userDataDir || mkdtempSync(join(tmpdir(), 'sally-browser-'));
    this.ephemeralUserDataDir = browserTarget.userDataDir ? null : userDataDir;

    console.log('[Playwright] Launching browser');
    console.log('[Playwright]   browser:', browserTarget.label);
    console.log('[Playwright]   executable:', browserTarget.executablePath || `channel:${browserTarget.channel || 'default'}`);
    console.log('[Playwright]   userDataDir:', browserTarget.userDataDir || `${userDataDir} (temporary)`);

    // Use launchPersistentContext to get the user's logged-in sessions
    this.context = await chromium.launchPersistentContext(
      userDataDir,
      {
        headless: false,
        ...(browserTarget.executablePath ? { executablePath: browserTarget.executablePath } : {}),
        ...(!browserTarget.executablePath && browserTarget.channel ? { channel: browserTarget.channel } : {}),
        args: [
          '--start-maximized',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
        ],
        viewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
      },
    );

    // Use existing tab or create one
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Clean up on disconnect
    this.context.on('close', () => {
      console.log('[Playwright] Browser context closed');
      this.context = null;
      this.page = null;
      this.cleanupEphemeralUserDataDir();
    });

    return this.page;
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const page = await this.launch();
    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  async getBrowserWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const page = await this.launch();

    try {
      const bounds = await page.evaluate(() => ({
        x: Math.round(Number((globalThis as Record<string, unknown>).screenX ?? 0)),
        y: Math.round(Number((globalThis as Record<string, unknown>).screenY ?? 0)),
        width: Math.max(Math.round(Number((globalThis as Record<string, unknown>).outerWidth ?? 0)), 1),
        height: Math.max(Math.round(Number((globalThis as Record<string, unknown>).outerHeight ?? 0)), 1),
      }));

      return bounds;
    } catch (error) {
      console.warn('[Playwright] Failed to read browser window bounds:', error);
      return null;
    }
  }

  async takeScreenshot(): Promise<string> {
    const page = await this.launch();
    const buffer = await page.screenshot({ type: 'png', fullPage: false, timeout: 10_000 });
    return buffer.toString('base64');
  }

  async executeAction(action: GeminiAction): Promise<string> {
    const page = await this.launch();

    try {
      switch (action.type) {
        case 'navigate': {
          if (!action.url) return 'No URL provided';
          let url = action.url;
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          await page.goto(url, { timeout: ACTION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
          try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
          } catch { /* page has ongoing requests, that's fine */ }
          return `Navigated to ${url}`;
        }

        case 'click': {
          if (!action.selector) return 'No selector provided';
          const clicked = await this.smartClick(page, action.selector);
          return clicked ? `Clicked "${action.selector}"` : `Could not find "${action.selector}"`;
        }

        case 'fill': {
          if (!action.selector || action.value === undefined) return 'Missing selector or value';
          const filled = await this.smartFill(page, action.selector, action.value);
          return filled ? `Typed "${action.value}" into "${action.selector}"` : `Could not find field "${action.selector}"`;
        }

        case 'select': {
          if (!action.selector || !action.value) return 'Missing selector or value';
          const selected = await this.smartSelect(page, action.selector, action.value);
          return selected ? `Selected "${action.value}" in "${action.selector}"` : `Could not select in "${action.selector}"`;
        }

        case 'press': {
          const key = action.value || 'Enter';
          await page.keyboard.press(key);
          return `Pressed ${key}`;
        }

        case 'type': {
          const text = action.value || '';
          if (!text) return 'No text to type';
          await page.keyboard.type(text, { delay: 50 });
          return `Typed "${text}" via keyboard`;
        }

        case 'hover': {
          if (!action.selector) return 'No selector provided';
          const hovered = await this.smartHover(page, action.selector);
          return hovered ? `Hovered over "${action.selector}"` : `Could not find "${action.selector}"`;
        }

        case 'back': {
          const beforeUrl = page.url();
          try {
            await page.goBack({ timeout: ACTION_TIMEOUT_MS });
          } catch { /* timeout is fine */ }
          const afterUrl = page.url();
          if (afterUrl === beforeUrl || !afterUrl || afterUrl === 'about:blank') {
            return 'Cannot go back, no previous page';
          }
          return 'Went back to previous page';
        }

        case 'scroll': {
          await page.mouse.wheel(0, 400);
          return 'Scrolled down';
        }

        case 'scroll_up': {
          await page.mouse.wheel(0, -400);
          return 'Scrolled up';
        }

        case 'wait': {
          const ms = Math.min(parseInt(action.value || '2000', 10) || 2000, 5000);
          await page.waitForTimeout(ms);
          return `Waited ${ms}ms`;
        }

        default:
          return `Unknown action type: ${action.type}`;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Playwright] Action failed:', msg);
      return `Action failed: ${msg}`;
    }
  }

  // Try to click the first visible matching element, filtering out hidden/off-screen ones
  private async clickVisible(locator: Locator): Promise<boolean> {
    const count = await locator.count();
    for (let i = 0; i < count && i < 5; i++) {
      const el = locator.nth(i);
      try {
        if (!(await el.isVisible({ timeout: 500 }))) continue;
        if (await el.isDisabled().catch(() => false)) continue;
        const ariaDisabled = await el.getAttribute('aria-disabled').catch(() => null);
        if (ariaDisabled === 'true') continue;
        await el.click({ timeout: 3000 });
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  private async smartClick(page: Page, selector: string): Promise<boolean> {
    if (selector.length > MAX_SELECTOR_LENGTH) selector = selector.slice(0, MAX_SELECTOR_LENGTH);
    // 1. CSS selector (also pierces shadow DOM via locator)
    try {
      await page.locator(selector).first().click({ timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 2. Visible text — pick the first visible match, not just first in DOM
    try {
      if (await this.clickVisible(page.getByText(selector, { exact: false }))) return true;
    } catch { /* fallback */ }

    // 3. ARIA roles — check visibility before clicking
    for (const role of ['button', 'link', 'menuitem', 'tab', 'checkbox', 'option', 'combobox'] as const) {
      try {
        if (await this.clickVisible(page.getByRole(role, { name: selector }))) return true;
      } catch { /* next */ }
    }

    // 4. ARIA label
    try {
      if (await this.clickVisible(page.getByLabel(selector))) return true;
    } catch { /* fallback */ }

    // 5. Placeholder
    try {
      if (await this.clickVisible(page.getByPlaceholder(selector))) return true;
    } catch { /* fallback */ }

    // 6. Title attribute
    try {
      if (await this.clickVisible(page.getByTitle(selector))) return true;
    } catch { /* fallback */ }

    // 7. Alt text (images)
    try {
      if (await this.clickVisible(page.getByAltText(selector))) return true;
    } catch { /* fallback */ }

    // 8. Shadow-piercing text locator
    try {
      const shadow = page.locator(`text="${selector}"`);
      if (await this.clickVisible(shadow)) return true;
    } catch { /* fallback */ }

    // 9. Try inside iframes
    if (await this.clickInFrames(page, selector)) return true;

    return false;
  }

  private async smartHover(page: Page, selector: string): Promise<boolean> {
    if (selector.length > MAX_SELECTOR_LENGTH) selector = selector.slice(0, MAX_SELECTOR_LENGTH);
    try {
      await page.locator(selector).first().hover({ timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByText(selector, { exact: false }).first().hover({ timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    for (const role of ['button', 'link', 'menuitem', 'tab'] as const) {
      try {
        await page.getByRole(role, { name: selector }).first().hover({ timeout: 2000 });
        return true;
      } catch { /* next */ }
    }

    try {
      await page.getByTitle(selector).first().hover({ timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    return false;
  }

  private async smartFill(page: Page, selector: string, value: string): Promise<boolean> {
    if (selector.length > MAX_SELECTOR_LENGTH) selector = selector.slice(0, MAX_SELECTOR_LENGTH);
    // 1. CSS selector
    try {
      await page.fill(selector, value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 2. Label
    try {
      await page.getByLabel(selector).first().fill(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 3. Placeholder
    try {
      await page.getByPlaceholder(selector).first().fill(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 4. Textbox role
    try {
      await page.getByRole('textbox', { name: selector }).first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    // 5. Searchbox role
    try {
      await page.getByRole('searchbox', { name: selector }).first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    // 6. Generic searchbox (no name filter)
    try {
      await page.getByRole('searchbox').first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    // 7. Combobox role (common for modern search inputs)
    try {
      await page.getByRole('combobox', { name: selector }).first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    // 8. Generic combobox
    try {
      await page.getByRole('combobox').first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    // 9. Try inside iframes
    if (await this.fillInFrames(page, selector, value)) return true;

    return false;
  }

  // Handle both native <select> and custom dropdowns
  private async smartSelect(page: Page, selector: string, value: string): Promise<boolean> {
    if (selector.length > MAX_SELECTOR_LENGTH) selector = selector.slice(0, MAX_SELECTOR_LENGTH);
    // 1. Native <select> by CSS
    try {
      await page.selectOption(selector, value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 2. Native <select> by label
    try {
      await page.getByLabel(selector).first().selectOption(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 3. Native <select> by role
    try {
      await page.getByRole('combobox', { name: selector }).first().selectOption(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    // 4. Custom dropdown: click to open, then click option by text
    try {
      const opened = await this.smartClick(page, selector);
      if (opened) {
        try {
          await page.waitForSelector('[role="listbox"], [role="menu"], [role="option"]', { timeout: 2000 });
        } catch {
          await page.waitForTimeout(800);
        }
        // Try clicking the option in listbox/menu
        for (const role of ['option', 'menuitem', 'listitem'] as const) {
          try {
            if (await this.clickVisible(page.getByRole(role, { name: value }))) return true;
          } catch { /* next */ }
        }
        // Fall back to clicking by text
        try {
          if (await this.clickVisible(page.getByText(value, { exact: false }))) return true;
        } catch { /* give up */ }
      }
    } catch { /* give up */ }

    return false;
  }

  // Try to click an element inside any iframe on the page
  private async clickInFrames(page: Page, selector: string): Promise<boolean> {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      try {
        // Text match
        const el = frame.getByText(selector, { exact: false }).first();
        if (await el.isVisible({ timeout: 500 })) {
          await el.click({ timeout: 3000 });
          return true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('cross-origin') || msg.includes('denied')) {
          console.warn('[Playwright] Cross-origin iframe skipped in clickInFrames (text):', msg);
        }
      }
      try {
        // Role match
        for (const role of ['button', 'link'] as const) {
          const el = frame.getByRole(role, { name: selector }).first();
          if (await el.isVisible({ timeout: 500 })) {
            await el.click({ timeout: 3000 });
            return true;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('cross-origin') || msg.includes('denied')) {
          console.warn('[Playwright] Cross-origin iframe skipped in clickInFrames (role):', msg);
        }
      }
    }
    return false;
  }

  // Try to fill a field inside any iframe on the page
  private async fillInFrames(page: Page, selector: string, value: string): Promise<boolean> {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      try {
        await frame.getByLabel(selector).first().fill(value, { timeout: 2000 });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('cross-origin') || msg.includes('denied')) {
          console.warn('[Playwright] Cross-origin iframe skipped in fillInFrames (label):', msg);
        }
      }
      try {
        await frame.getByPlaceholder(selector).first().fill(value, { timeout: 2000 });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('cross-origin') || msg.includes('denied')) {
          console.warn('[Playwright] Cross-origin iframe skipped in fillInFrames (placeholder):', msg);
        }
      }
      try {
        await frame.getByRole('textbox', { name: selector }).first().fill(value, { timeout: 2000 });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('cross-origin') || msg.includes('denied')) {
          console.warn('[Playwright] Cross-origin iframe skipped in fillInFrames (role):', msg);
        }
      }
    }
    return false;
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        console.log('[Playwright] Browser closed');
      }
    } catch (error) {
      console.error('[Playwright] Error closing browser:', error);
    } finally {
      this.context = null;
      this.page = null;
      this.cleanupEphemeralUserDataDir();
    }
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  private cleanupEphemeralUserDataDir(): void {
    if (!this.ephemeralUserDataDir) return;

    try {
      rmSync(this.ephemeralUserDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures for temporary browser profiles.
    } finally {
      this.ephemeralUserDataDir = null;
    }
  }
}

export const playwrightService = new PlaywrightService();
