// Sally Vision Backend - Gemini multimodal proxy for Cloud Run
// POST /api/interpret-screen        -> { narration, action }
// POST /api/answer-screen-question  -> { answer, shouldResearch, researchQuery }

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const VALID_ACTION_TYPES = new Set([
  'navigate', 'click', 'fill', 'type', 'select', 'press',
  'hover', 'focus', 'check', 'uncheck', 'scroll', 'scroll_up', 'back', 'wait', 'null',
]);

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL });
});

function getGroundingBlock(pageUrl, pageTitle) {
  if (typeof pageUrl !== 'string' || !pageUrl) {
    return '';
  }

  return `\n\nCurrent page:\n- URL: ${pageUrl}\n- Title: ${typeof pageTitle === 'string' && pageTitle ? pageTitle : '(untitled)'}`;
}

function getPageContextBlock(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') {
    return '';
  }

  const interactiveElements = Array.isArray(pageContext.interactiveElements)
    ? pageContext.interactiveElements.slice(0, 12)
    : [];

  const controls = interactiveElements
    .map((element) => {
      if (!element || typeof element !== 'object') return null;
      const descriptor = [element.label, element.text, element.placeholder].find((value) => typeof value === 'string' && value.trim())
        || element.tagName
        || 'element';
      const state = [];
      if (element.disabled) state.push('disabled');
      if (element.checked) state.push('checked');
      if (element.selected) state.push('selected');
      const suffix = state.length > 0 ? ` (${state.join(', ')})` : '';
      return `${element.index || '?'}. ${String(element.role || 'element')} "${String(descriptor).trim()}"${suffix}`;
    })
    .filter(Boolean)
    .join('\n');

  const blocks = [
    typeof pageContext.semanticSummary === 'string' && pageContext.semanticSummary.trim()
      ? `Semantic summary:\n${pageContext.semanticSummary.trim()}`
      : '',
    controls ? `Visible interactive elements:\n${controls}` : '',
    Array.isArray(pageContext.headings) && pageContext.headings.length > 0
      ? `Headings:\n${pageContext.headings.slice(0, 8).join('\n')}`
      : '',
    Array.isArray(pageContext.visibleMessages) && pageContext.visibleMessages.length > 0
      ? `Visible messages:\n${pageContext.visibleMessages.slice(0, 8).join('\n')}`
      : '',
    Array.isArray(pageContext.dialogs) && pageContext.dialogs.length > 0
      ? `Dialogs:\n${pageContext.dialogs.slice(0, 4).join('\n')}`
      : '',
    typeof pageContext.activeElement === 'string' && pageContext.activeElement.trim()
      ? `Focused element:\n${pageContext.activeElement.trim()}`
      : '',
  ].filter(Boolean);

  return blocks.length > 0 ? `\n\nStructured page context:\n${blocks.join('\n\n')}` : '';
}

function getSourceModeBlock(sourceMode) {
  if (sourceMode !== 'electron_browser') {
    return '';
  }

  return '\n\nBrowser source mode:\n- electron_browser (Sally-owned Electron browser with live DOM access)';
}

function parseJsonResponse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(stripped);
    } catch {
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return fallback;
        }
      }
      return fallback;
    }
  }
}

function normalizeInterpretResult(raw) {
  const narration = typeof raw?.narration === 'string' && raw.narration
    ? raw.narration
    : 'I can see the screen.';

  let action = null;
  if (raw?.action && typeof raw.action === 'object' && !Array.isArray(raw.action)) {
    const candidate = raw.action;
    if (typeof candidate.type === 'string' && VALID_ACTION_TYPES.has(candidate.type)) {
      action = { type: candidate.type };
      if (typeof candidate.selector === 'string') action.selector = candidate.selector;
      if (typeof candidate.index === 'number' && Number.isFinite(candidate.index) && candidate.index > 0) {
        action.index = Math.floor(candidate.index);
      }
      if (typeof candidate.value === 'string') action.value = candidate.value;
      if (typeof candidate.url === 'string') action.url = candidate.url;
    }
  }

  return { narration, action };
}

function normalizeScreenQuestionResult(raw) {
  const answer = typeof raw?.answer === 'string' && raw.answer.trim()
    ? raw.answer.trim()
    : "I can see the screen, but I couldn't answer that clearly from the image.";

  const researchQuery = typeof raw?.researchQuery === 'string' && raw.researchQuery.trim()
    ? raw.researchQuery.trim()
    : null;

  return {
    answer,
    shouldResearch: Boolean(raw?.shouldResearch) && Boolean(researchQuery),
    researchQuery,
  };
}

async function generateJson({ screenshot, prompt, systemInstruction, fallback, maxOutputTokens = 512, temperature = 0.2 }) {
  const result = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: screenshot,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      maxOutputTokens,
      temperature,
    },
  });

  return parseJsonResponse(result.text || '', fallback);
}

app.post('/api/interpret-screen', async (req, res) => {
  const { screenshot, instruction, history, pageUrl, pageTitle, pageContext, sourceMode } = req.body ?? {};

  if (!screenshot || typeof screenshot !== 'string') {
    return res.status(400).json({ error: 'screenshot (base64 PNG) is required' });
  }

  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'instruction string is required' });
  }

  const systemPrompt = `You are Sally, a voice-first accessibility assistant helping users navigate the web.

Your job:
1. Briefly describe what matters on screen for the user's goal.
2. Return exactly one next action when interaction is needed.
3. Set action to null when the task is complete or purely descriptive.

Rules:
- Base your answer on what is visible.
- Use the screenshot as the primary truth and page context as a grounding aid.
- Use visible labels, text, roles, and ordinal position for selectors.
- Keep narration short and natural because it will be spoken aloud.`;

  const historyBlock = Array.isArray(history) && history.length > 0
    ? `\n\nSteps already completed:\n${history.map((step, index) => `${index + 1}. ${String(step)}`).join('\n')}\n\nDo not repeat completed steps. If any step is marked FAILED, try a different selector or approach.`
    : '';

  const prompt = `User instruction: "${instruction}"${getGroundingBlock(pageUrl, pageTitle)}${getSourceModeBlock(sourceMode)}${getPageContextBlock(pageContext)}${historyBlock}

Respond with valid JSON only:
{
  "narration": "1-2 spoken sentences describing what matters for the user's goal",
  "action": {
    "type": "navigate|click|fill|type|select|press|hover|focus|check|uncheck|scroll|scroll_up|back|wait|null",
    "selector": "visible text, aria-label, placeholder, or CSS selector",
    "index": 1,
    "value": "text to type, selected option, pressed key, or wait duration",
    "url": "URL to navigate to"
  }
}

If no action is needed, set action to null.
Use "index" only when there are multiple similar visible matches and ordinal targeting helps.`;

  try {
    const raw = await generateJson({
      screenshot,
      prompt,
      systemInstruction: systemPrompt,
      fallback: { narration: 'I can see the screen.', action: null },
      maxOutputTokens: 512,
      temperature: 0.2,
    });

    return res.json(normalizeInterpretResult(raw));
  } catch (error) {
    console.error('[Sally Backend] Gemini interpret error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Gemini API error: ${message}` });
  }
});

app.post('/api/answer-screen-question', async (req, res) => {
  const { screenshot, question, pageUrl, pageTitle, autoResearchEnabled, pageContext, sourceMode } = req.body ?? {};

  if (!screenshot || typeof screenshot !== 'string') {
    return res.status(400).json({ error: 'screenshot (base64 PNG) is required' });
  }

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question string is required' });
  }

  const researchRules = autoResearchEnabled
    ? 'Auto-research is enabled. Set shouldResearch=true only when the user clearly wants extra information beyond what is visible and you can form a safe, specific search query from visible names or text.'
    : 'Auto-research is disabled. Always return shouldResearch=false and researchQuery=null.';

  const systemPrompt = `You are Sally, a multimodal accessibility assistant answering questions about what is visible on screen.

Rules:
- Answer from the screenshot first.
- Keep the answer short and natural because it will be spoken aloud.
- If something is unclear, say so honestly.
- Use page context only as a grounding aid when it matches the screenshot.
- Count conservatively and say "at least" when visibility is partial.
- Do not guess a person's identity from appearance alone.`;

  const prompt = `User question about the screenshot: "${question}"${getGroundingBlock(pageUrl, pageTitle)}${getSourceModeBlock(sourceMode)}${getPageContextBlock(pageContext)}

${researchRules}

Respond with valid JSON only:
{
  "answer": "short spoken answer to the user's question",
  "shouldResearch": true,
  "researchQuery": "specific web search query or null"
}`;

  try {
    const raw = await generateJson({
      screenshot,
      prompt,
      systemInstruction: systemPrompt,
      fallback: {
        answer: "I can see the screen, but I couldn't answer that clearly from the image.",
        shouldResearch: false,
        researchQuery: null,
      },
      maxOutputTokens: 384,
      temperature: 0.1,
    });

    return res.json(normalizeScreenQuestionResult(raw));
  } catch (error) {
    console.error('[Sally Backend] Gemini screen-question error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Gemini API error: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Sally Vision Backend running on port ${PORT}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
});
