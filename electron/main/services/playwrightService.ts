// Playwright browser automation service — uses the user's real Chrome profile
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { GeminiAction } from './geminiService.js';

const ACTION_TIMEOUT_MS = 10_000;

// Browser executable paths (Windows) — Chrome first, Edge as fallback
const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : '',
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome SxS\\Application\\chrome.exe`
    : '',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

// Chrome user data directories (Windows)
const CHROME_PROFILE_PATHS = [
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
    : '',
  join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
].filter(Boolean);

const EDGE_PROFILE_PATHS = [
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data')
    : '',
  join(homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
].filter(Boolean);

class PlaywrightService {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private findBrowser(): string | undefined {
    for (const p of BROWSER_PATHS) {
      try {
        if (existsSync(p)) return p;
      } catch { /* skip */ }
    }
    return undefined;
  }

  private findUserDataDir(executablePath?: string): string | undefined {
    // If we're using Edge, look for Edge profile
    const isEdge = executablePath?.toLowerCase().includes('edge');
    const paths = isEdge ? EDGE_PROFILE_PATHS : CHROME_PROFILE_PATHS;

    for (const p of paths) {
      try {
        if (existsSync(p)) {
          console.log('[Playwright] Found user data dir:', p);
          return p;
        }
      } catch { /* skip */ }
    }

    // Fallback: try Chrome profiles even if using Edge
    if (isEdge) {
      for (const p of CHROME_PROFILE_PATHS) {
        try {
          if (existsSync(p)) return p;
        } catch { /* skip */ }
      }
    }

    return undefined;
  }

  async launch(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const executablePath = this.findBrowser();
    const userDataDir = this.findUserDataDir(executablePath);

    console.log('[Playwright] Launching browser');
    console.log('[Playwright]   executable:', executablePath || 'bundled');
    console.log('[Playwright]   userDataDir:', userDataDir || 'none (clean profile)');

    // Use launchPersistentContext to get the user's logged-in sessions
    this.context = await chromium.launchPersistentContext(
      userDataDir || '',
      {
        headless: false,
        ...(executablePath ? { executablePath } : {}),
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

  async takeScreenshot(): Promise<string> {
    const page = await this.launch();
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
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
          try {
            await page.selectOption(action.selector, action.value, { timeout: ACTION_TIMEOUT_MS });
            return `Selected "${action.value}" in "${action.selector}"`;
          } catch {
            return `Could not select in "${action.selector}"`;
          }
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
          await page.goBack({ timeout: ACTION_TIMEOUT_MS });
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

  private async smartClick(page: Page, selector: string): Promise<boolean> {
    try {
      await page.click(selector, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByText(selector, { exact: false }).first().click({ timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    for (const role of ['button', 'link', 'menuitem', 'tab', 'checkbox'] as const) {
      try {
        await page.getByRole(role, { name: selector }).first().click({ timeout: 2000 });
        return true;
      } catch { /* next */ }
    }

    try {
      await page.getByLabel(selector).first().click({ timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByPlaceholder(selector).first().click({ timeout: 2000 });
      return true;
    } catch { /* give up */ }

    return false;
  }

  private async smartHover(page: Page, selector: string): Promise<boolean> {
    try {
      await page.hover(selector, { timeout: 3000 });
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

    return false;
  }

  private async smartFill(page: Page, selector: string, value: string): Promise<boolean> {
    try {
      await page.fill(selector, value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByLabel(selector).first().fill(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByPlaceholder(selector).first().fill(value, { timeout: 3000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByRole('textbox', { name: selector }).first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* fallback */ }

    try {
      await page.getByRole('searchbox').first().fill(value, { timeout: 2000 });
      return true;
    } catch { /* give up */ }

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
    }
  }

  isRunning(): boolean {
    return this.context !== null;
  }
}

export const playwrightService = new PlaywrightService();
