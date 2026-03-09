// Session manager - orchestrates voice -> transcribe -> Playwright+Gemini agentic loop -> TTS
import { windowManager } from '../windowManager.js';
import { whisperService } from '../services/whisperService.js';
import { ttsService } from '../services/ttsService.js';
import { geminiService } from '../services/geminiService.js';
import { screenshotService } from '../services/screenshotService.js';
import { playwrightService } from '../services/playwrightService.js';
import { apiKeyManager } from './apiKeyManager.js';
import type { GeminiAction } from '../services/geminiService.js';
import type { SallyState } from '../../../shared/types.js';

const DESCRIBE_COMMANDS = [
  'what do i see',
  'describe screen',
  'describe the screen',
  'where am i',
  'what is on the screen',
  'describe the page',
  'what page am i on',
  'what can i see',
  'read the screen',
];

// Smart home command patterns → rewritten as browser instructions
const SMART_HOME_PATTERNS: Array<{ pattern: RegExp; rewrite: (match: RegExpMatchArray) => string }> = [
  // Lights
  {
    pattern: /\b(?:turn\s+(?:on|off)|switch\s+(?:on|off))\s+(?:the\s+)?(?:(.+?)\s+)?lights?\b/i,
    rewrite: (m) => {
      const onOff = m[0].match(/\bon\b/i) ? 'on' : 'off';
      const room = m[1] ? m[1].trim() : '';
      return `Go to home.google.com, find the ${room ? room + ' ' : ''}light${room ? '' : 's'}, and turn ${onOff === 'on' ? 'it' : 'them'} ${onOff}.`;
    },
  },
  {
    pattern: /\blights?\s+(on|off)\b/i,
    rewrite: (m) => `Go to home.google.com, find the lights, and turn them ${m[1].toLowerCase()}.`,
  },
  // Thermostat / temperature
  {
    pattern: /\b(?:set|change)\s+(?:the\s+)?(?:thermostat|temperature|temp)\s+(?:to\s+)?(\d+)/i,
    rewrite: (m) => `Go to home.google.com, find the thermostat, and set the temperature to ${m[1]} degrees.`,
  },
  // Fan
  {
    pattern: /\b(?:turn\s+(?:on|off)|switch\s+(?:on|off))\s+(?:the\s+)?(?:(.+?)\s+)?fan\b/i,
    rewrite: (m) => {
      const onOff = m[0].match(/\bon\b/i) ? 'on' : 'off';
      const room = m[1] ? m[1].trim() + ' ' : '';
      return `Go to home.google.com, find the ${room}fan, and turn it ${onOff}.`;
    },
  },
  // Generic device on/off
  {
    pattern: /\b(?:turn\s+(on|off)|switch\s+(on|off))\s+(?:the\s+)?(.+)/i,
    rewrite: (m) => {
      const onOff = (m[1] || m[2]).toLowerCase();
      const device = m[3].trim();
      return `Go to home.google.com, find "${device}", and turn it ${onOff}.`;
    },
  },
];

const MAX_ITERATIONS = 15;
const MAX_DURATION_MS = 3 * 60 * 1000; // 3 minutes
const SETTLE_DELAY_MS = 1500;

class SessionManager {
  private state: SallyState = 'idle';
  private isCancelled = false;
  private waitTimeout: NodeJS.Timeout | null = null;

  initialize(): void {
    console.log('[SessionManager] Initialized (Playwright + Gemini agentic mode)');
  }

  async handleTranscription(audioBase64: string, mimeType: string): Promise<string> {
    this.setState('processing');

    try {
      if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasWhisperKey()) {
        ttsService.speakImmediate('Please configure your Gemini API key in settings for speech transcription.');
        this.setState('idle');
        return '';
      }

      const text = await whisperService.transcribe(audioBase64, mimeType);
      console.log('[SessionManager] Transcribed:', text);

      if (!text.trim()) {
        this.setState('idle');
        return '';
      }

      if (text.toLowerCase().trim().includes('cancel')) {
        await this.cancel();
        return text;
      }

      this.executeTask(text).catch((error) => {
        console.error('[SessionManager] Task execution failed:', error);
        ttsService.speakImmediate('Something went wrong. Please try again.');
        this.setState('idle');
      });

      return text;
    } catch (error) {
      console.error('[SessionManager] Transcription failed:', error);
      ttsService.speakImmediate("I couldn't understand that, please try again.");
      this.setState('idle');
      return '';
    }
  }

  async executeTask(text: string): Promise<void> {
    const normalizedText = text.toLowerCase().trim();
    const isDescribeCommand = DESCRIBE_COMMANDS.some(cmd => normalizedText.includes(cmd));

    if (isDescribeCommand) {
      await this.describeScreen();
      return;
    }

    // Check for smart home commands and rewrite them as browser instructions
    const expanded = this.expandSmartCommand(text);
    if (expanded !== text) {
      console.log('[SessionManager] Smart command expanded:', text, '→', expanded);
    }

    await this.agenticBrowse(expanded);
  }

  private expandSmartCommand(text: string): string {
    for (const { pattern, rewrite } of SMART_HOME_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return rewrite(match);
      }
    }
    return text;
  }

  async previewTranscription(audioBase64: string, mimeType: string): Promise<string> {
    try {
      if (!apiKeyManager.hasGeminiApiKey() && !apiKeyManager.hasWhisperKey()) {
        return '';
      }

      const text = await whisperService.transcribe(audioBase64, mimeType);
      const trimmed = text.trim();
      if (trimmed) {
        console.log('[SessionManager] Live preview transcription:', trimmed);
      }
      return trimmed;
    } catch (error) {
      console.warn('[SessionManager] Live preview transcription failed:', error);
      return '';
    }
  }

  async describeScreen(): Promise<void> {
    this.setState('acting');
    try {
      ttsService.speakImmediate('Let me take a look...');
      const screenshot = await screenshotService.captureScreen();
      const result = await geminiService.interpretScreen({
        screenshot,
        instruction: 'Describe what you see on this screen. Mention the main content, page title, key buttons or links, and what actions are available. Keep it under 3 sentences, spoken naturally.',
      });
      ttsService.speak(result.narration);
    } catch (error) {
      console.error('[SessionManager] describeScreen failed:', error);
      ttsService.speakImmediate("Sorry, I couldn't see the screen right now. Check your Gemini API key in settings.");
    } finally {
      this.setState('idle');
    }
  }

  private async agenticBrowse(instruction: string): Promise<void> {
    if (!apiKeyManager.hasGeminiApiKey()) {
      ttsService.speakImmediate("I need a Gemini API key to work. You can add one in settings.");
      this.setState('idle');
      return;
    }

    this.setState('acting');
    this.isCancelled = false;

    const startTime = Date.now();
    const history: string[] = [];

    try {
      ttsService.speakImmediate("On it! Let me handle that for you.");

      // Ensure browser is launched
      await playwrightService.launch();

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Check cancellation
        if (this.isCancelled) {
          console.log('[SessionManager] Agentic loop cancelled at iteration', i);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > MAX_DURATION_MS) {
          console.log('[SessionManager] Agentic loop timed out');
          ttsService.speak("This is taking a while, so I'll stop here. You can try again with a simpler request.");
          break;
        }

        console.log(`[SessionManager] Agentic loop iteration ${i + 1}/${MAX_ITERATIONS}`);

        // Take screenshot and get page info for grounding
        const screenshot = await playwrightService.takeScreenshot();
        const pageInfo = await playwrightService.getPageInfo();

        // Send to Gemini for interpretation (with grounding + action history)
        const result = await geminiService.interpretScreen({
          screenshot,
          instruction,
          history,
          pageUrl: pageInfo.url,
          pageTitle: pageInfo.title,
        });
        console.log('[SessionManager] Gemini result:', result.narration, result.action);

        // Broadcast to UI
        windowManager.broadcastToAll('sally:chat', {
          role: 'assistant',
          text: result.narration,
        });

        // Narrate what Gemini sees
        if (result.narration) {
          ttsService.speak(result.narration);
        }

        // If no action needed, task is complete
        if (!result.action || result.action.type === 'null') {
          console.log('[SessionManager] Agentic loop complete — no more actions');
          break;
        }

        // Check cancellation before executing
        if (this.isCancelled) return;

        // Execute the action
        const actionResult = await playwrightService.executeAction(result.action);
        console.log('[SessionManager] Action result:', actionResult);

        // Add to history so Gemini knows what's already been done
        const actionDesc = this.describeAction(result.action, actionResult);
        history.push(actionDesc);
        if (history.length > 10) history.shift();

        windowManager.broadcastToAll('sally:step', {
          action: result.action.type,
          details: actionResult,
          timestamp: Date.now(),
        });

        // Wait for page to settle
        await new Promise(resolve => setTimeout(resolve, SETTLE_DELAY_MS));
      }
    } catch (error) {
      console.error('[SessionManager] Agentic browse failed:', error);
      ttsService.speakImmediate("Hmm, something went wrong. Let me know if you'd like to try again.");
    } finally {
      if (!this.isCancelled) {
        this.setState('idle');
      }
    }
  }

  private describeAction(action: GeminiAction, result: string): string {
    switch (action.type) {
      case 'navigate': return `Navigated to ${action.url}`;
      case 'click': return `Clicked "${action.selector}" — ${result}`;
      case 'fill': return `Filled "${action.selector}" with "${action.value}"`;
      case 'type': return `Typed "${action.value}"`;
      case 'select': return `Selected "${action.value}" in "${action.selector}"`;
      case 'press': return `Pressed ${action.value || 'Enter'}`;
      case 'hover': return `Hovered over "${action.selector}"`;
      case 'scroll': return 'Scrolled down';
      case 'scroll_up': return 'Scrolled up';
      case 'back': return 'Went back to previous page';
      case 'wait': return `Waited ${action.value || '2000'}ms`;
      default: return `${action.type}: ${result}`;
    }
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    ttsService.stop();
    ttsService.speakImmediate('Cancelled.');
    windowManager.hideSallyBar();
    this.setState('idle');
  }

  setState(state: SallyState): void {
    this.state = state;
    if (state === 'idle') {
      windowManager.hideBorderOverlay();
    } else {
      windowManager.showSallyBar();
      if (state === 'awaiting_response') {
        windowManager.hideBorderOverlay();
      } else {
        windowManager.showBorderOverlay();
      }
    }
    windowManager.broadcastToAll('sally:state-changed', { state });
  }

  getState(): SallyState {
    return this.state;
  }

  setListening(): void {
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this.setState('listening');
  }

  setIdle(): void {
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this.setState('idle');
  }
}

export const sessionManager = new SessionManager();
