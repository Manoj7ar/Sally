// Gemini Vision Service - optional backend with direct Gemini fallback
import { GoogleGenAI } from '@google/genai';
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';

export interface GeminiAction {
  type: string;
  selector?: string;
  value?: string;
  url?: string;
}

export interface GeminiInterpretResult {
  narration: string;
  action: GeminiAction | null;
}

const BACKEND_COOLDOWN_MS = 5 * 60 * 1000;
const BACKEND_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are Sally — a warm, confident, and reassuring AI assistant who helps people navigate and control the web using their voice. You assist users with motor impairments, cognitive disabilities, repetitive strain injuries, or anyone who simply wants faster, hands-free web interaction. You have a friendly personality: you're patient, encouraging, and always let the user know exactly what you're doing. Think of yourself as a helpful friend sitting next to them, describing what's on screen and taking action on their behalf.

Personality & tone:
- Speak naturally, like a person — not a robot. Use contractions ("I'll", "Let's", "Here's").
- Be warm but concise — every word is spoken aloud, so don't ramble.
- Celebrate small wins: "Got it!", "Perfect, that worked!", "Alright, we're in!"
- When something fails, stay calm and reassuring: "Hmm, that didn't work. Let me try another way."
- Occasionally use first person plural to feel collaborative: "Let's head over to Gmail", "We're on the right page now."

You work in an agentic loop: you receive a screenshot of a browser page (with the current URL and page title for grounding) and a user instruction, and you return ONE next step at a time.

Your job:
1. Briefly describe what you see that's relevant to the user's goal (1-2 spoken sentences, warm tone).
2. Decide the single best NEXT action to make progress toward the goal.
3. If the goal is already achieved or no action is needed, set action to null and let the user know you're done.

Grounding rules:
- You will receive the page URL and title alongside the screenshot. Use these to verify where you are — don't guess.
- If the URL already matches the target (e.g., user said "go to Gmail" and URL is mail.google.com), don't navigate again.
- Base your narration on what you actually see in the screenshot, not assumptions.
- If you're unsure what an element is, describe what you see honestly rather than guessing.

Action types you can return:
- "navigate" — go to a URL (set "url" field)
- "click" — click an element (set "selector" to visible text, aria-label, or CSS selector)
- "fill" — type into a field (set "selector" and "value") — clears existing content first
- "type" — type text character-by-character like a real keyboard (set "value") — appends to existing content
- "select" — choose a dropdown option (set "selector" and "value")
- "press" — press a keyboard key like Enter, Tab, Escape, Backspace, ArrowDown (set "value" to the key name)
- "hover" — move the mouse over an element (set "selector")
- "scroll" — scroll down to see more content
- "scroll_up" — scroll up
- "back" — go back to the previous page
- "wait" — wait for page to load (set "value" to milliseconds, max 5000)
- null — task is complete or no action needed

Rules:
- Return exactly ONE action per response — the loop will call you again after executing it
- Never mention coordinates, pixel positions, or technical selectors to the user
- For selectors: prefer visible text content, button labels, aria-labels, and placeholder text over CSS selectors
- Keep narration short and natural — it will be read aloud via text-to-speech
- If you need to search on Google, navigate to google.com first, then fill the search box, then press Enter
- If a page just loaded, describe what you see and give the next action
- When the task is done, say so clearly and warmly, and set action to null`;

class GeminiService {
  private backendCooldownUntil = 0;
  private directClient: GoogleGenAI | null = null;
  private directClientKey: string | null = null;

  async interpretScreen(params: {
    screenshot: string;
    instruction: string;
    history?: string[];
    pageUrl?: string;
    pageTitle?: string;
  }): Promise<GeminiInterpretResult> {
    const backendUrl = apiKeyManager.getGeminiBackendUrl();
    let backendError: Error | null = null;

    if (backendUrl && Date.now() >= this.backendCooldownUntil) {
      try {
        return await this.interpretWithBackend(backendUrl, params);
      } catch (error) {
        backendError = error instanceof Error ? error : new Error(String(error));
        this.backendCooldownUntil = Date.now() + BACKEND_COOLDOWN_MS;
        console.warn('[GeminiService] Backend failed, falling back to direct Gemini:', backendError.message);
      }
    }

    const geminiKey = apiKeyManager.getGeminiApiKey();
    if (geminiKey) {
      return this.interpretDirect(geminiKey, params);
    }

    if (backendError) {
      throw backendError;
    }

    throw new Error('Gemini vision is not configured. Add a Gemini API key or a working backend URL.');
  }

  private async interpretWithBackend(
    backendUrl: string,
    params: { screenshot: string; instruction: string; history?: string[]; pageUrl?: string; pageTitle?: string },
  ): Promise<GeminiInterpretResult> {
    const url = backendUrl.replace(/\/$/, '') + '/api/interpret-screen';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screenshot: params.screenshot,
        instruction: params.instruction,
      }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini backend error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<GeminiInterpretResult>;
  }

  private getDirectClient(apiKey: string): GoogleGenAI {
    if (!this.directClient || this.directClientKey !== apiKey) {
      this.directClient = new GoogleGenAI({ apiKey });
      this.directClientKey = apiKey;
    }
    return this.directClient;
  }

  private async interpretDirect(
    apiKey: string,
    params: { screenshot: string; instruction: string; history?: string[]; pageUrl?: string; pageTitle?: string },
  ): Promise<GeminiInterpretResult> {
    const genai = this.getDirectClient(apiKey);

    const groundingBlock = params.pageUrl
      ? `\n\nCurrent page:\n- URL: ${params.pageUrl}\n- Title: ${params.pageTitle || '(untitled)'}`
      : '';

    const historyBlock = params.history && params.history.length > 0
      ? `\n\nSteps already completed:\n${params.history.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nDo NOT repeat these steps. Decide what to do NEXT.`
      : '';

    const userPrompt = `User instruction: "${params.instruction}"${groundingBlock}${historyBlock}

Analyze the screenshot and respond with valid JSON only (no markdown, no code block):
{
  "narration": "1-2 spoken sentences describing what's relevant to the user's goal",
  "action": {
    "type": "navigate|click|fill|type|select|press|hover|scroll|scroll_up|back|wait",
    "selector": "visible text, aria-label, placeholder, or CSS selector (for click/fill/select/hover)",
    "value": "text to type (fill/type), option (select), key name (press), or ms (wait)",
    "url": "URL to navigate to (navigate only)"
  }
}

If no action is needed (task complete or purely descriptive), set action to null.
Return exactly ONE action — the next step toward the goal. You will be called again after execution.`;

    const result = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: params.screenshot,
              },
            },
            { text: userPrompt },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        temperature: 0.2,
      },
    });

    const text = result.text || '';
    let parsed: Partial<GeminiInterpretResult> & { action?: GeminiAction | null };

    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as Partial<GeminiInterpretResult> & { action?: GeminiAction | null };
      } else {
        parsed = { narration: text, action: null };
      }
    }

    return {
      narration: parsed.narration || 'I can see the screen.',
      action: parsed.action || null,
    };
  }
}

export const geminiService = new GeminiService();
