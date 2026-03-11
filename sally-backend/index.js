// Sally Vision Backend - Gemini multimodal proxy for Cloud Run
// POST /api/interpret-screen        -> { narration, action }
// POST /api/answer-screen-question  -> { answer, shouldResearch, researchQuery }
// POST /api/interpret-user-request  -> { intent, confidence, normalizedInstruction, ... }
// POST /api/plan-complex-task       -> { status, planSummary, activeSubtask, ... }

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const VALID_ACTION_TYPES = new Set([
  'navigate', 'click', 'fill', 'type', 'select', 'press',
  'hover', 'focus', 'check', 'uncheck', 'scroll', 'scroll_up', 'back', 'wait',
  'open_tab', 'switch_tab', 'null',
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
      if (typeof element.expanded === 'boolean') state.push(element.expanded ? 'expanded' : 'collapsed');
      if (typeof element.pressed === 'boolean') state.push(element.pressed ? 'pressed' : 'not pressed');
      const scope = [];
      if (Array.isArray(element.framePath) && element.framePath.length > 0) scope.push(`frame=${element.framePath.join('.')}`);
      if (Array.isArray(element.shadowPath) && element.shadowPath.length > 0) scope.push(`shadow=${element.shadowPath.join('.')}`);
      const suffix = state.length > 0 ? ` (${state.join(', ')})` : '';
      const scopeSuffix = scope.length > 0 ? ` [${scope.join(' ')}]` : '';
      return `${element.index || '?'}. ${String(element.role || 'element')} "${String(descriptor).trim()}" [targetId=${String(element.targetId || '?')}]${scopeSuffix}${suffix}`;
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

function getTabsBlock(tabs, activeTabId) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return '';
  }

  const lines = tabs
    .slice(0, 8)
    .map((tab, index) => {
      if (!tab || typeof tab !== 'object') return null;
      const title = typeof tab.title === 'string' && tab.title ? tab.title : '(untitled)';
      const url = typeof tab.url === 'string' && tab.url ? tab.url : '(unknown)';
      const isActive = tab.id === activeTabId || tab.isActive;
      return `${index + 1}. ${isActive ? 'ACTIVE ' : ''}[tabId=${String(tab.id || '?')}] ${title} - ${url}`;
    })
    .filter(Boolean)
    .join('\n');

  return lines ? `\n\nOpen tabs:\n${lines}` : '';
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
      if (typeof candidate.tabId === 'string') action.tabId = candidate.tabId;
      if (typeof candidate.targetId === 'string') action.targetId = candidate.targetId;
      if (Array.isArray(candidate.framePath)) {
        action.framePath = candidate.framePath
          .filter((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)
          .map((item) => Math.floor(item));
      }
      if (Array.isArray(candidate.shadowPath)) {
        action.shadowPath = candidate.shadowPath
          .filter((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)
          .map((item) => Math.floor(item));
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

function normalizeUserRequestInterpretation(raw, transcript) {
  const intent = [
    'browser_task',
    'browser_assistive',
    'describe_screen',
    'summarize_screen',
    'screen_question',
    'smart_home',
    'chat',
    'cancel',
    'clarify',
    'none',
  ].includes(raw?.intent)
    ? raw.intent
    : 'none';

  const confidence = raw?.confidence === 'high' || raw?.confidence === 'medium'
    ? raw.confidence
    : 'low';

  const normalizedInstruction = typeof raw?.normalizedInstruction === 'string' && raw.normalizedInstruction.trim()
    ? raw.normalizedInstruction.trim()
    : (typeof transcript === 'string' && transcript.trim() ? transcript.trim() : null);

  const spokenResponse = typeof raw?.spokenResponse === 'string' && raw.spokenResponse.trim()
    ? raw.spokenResponse.trim()
    : null;

  const clarificationQuestion = typeof raw?.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
    ? raw.clarificationQuestion.trim()
    : null;

  const browserAssistiveIntent = [
    'actions',
    'buttons',
    'fields',
    'errors',
    'links',
    'headings',
  ].includes(raw?.browserAssistiveIntent)
    ? raw.browserAssistiveIntent
    : null;

  return {
    intent,
    confidence,
    normalizedInstruction,
    spokenResponse,
    clarificationQuestion,
    browserAssistiveIntent,
  };
}

function normalizeTaskPlan(raw, goal) {
  const status = ['complete', 'blocked', 'clarify'].includes(raw?.status)
    ? raw.status
    : 'continue';

  const planSummary = typeof raw?.planSummary === 'string' && raw.planSummary.trim()
    ? raw.planSummary.trim()
    : goal;

  const activeSubtask = typeof raw?.activeSubtask === 'string' && raw.activeSubtask.trim()
    ? raw.activeSubtask.trim()
    : null;

  const subtasks = Array.isArray(raw?.subtasks)
    ? raw.subtasks
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .slice(0, 6)
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `s${index + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Step ${index + 1}`,
        status: ['done', 'blocked', 'active'].includes(item.status) ? item.status : 'pending',
      }))
    : [];

  const rememberedFacts = Array.isArray(raw?.rememberedFacts)
    ? raw.rememberedFacts
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim())
      .slice(0, 12)
    : [];

  const clarificationQuestion = typeof raw?.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
    ? raw.clarificationQuestion.trim()
    : null;
  const completionNarration = typeof raw?.completionNarration === 'string' && raw.completionNarration.trim()
    ? raw.completionNarration.trim()
    : null;
  const blockedReason = typeof raw?.blockedReason === 'string' && raw.blockedReason.trim()
    ? raw.blockedReason.trim()
    : null;

  const normalizedSubtasks = subtasks.length > 0
    ? subtasks
    : [
        {
          id: 's1',
          title: activeSubtask || goal,
          status: status === 'complete' ? 'done' : 'active',
        },
      ];

  return {
    status,
    planSummary,
    activeSubtask: activeSubtask
      || normalizedSubtasks.find((item) => item.status === 'active')?.title
      || normalizedSubtasks.find((item) => item.status === 'pending')?.title
      || null,
    subtasks: normalizedSubtasks,
    rememberedFacts,
    clarificationQuestion,
    completionNarration,
    blockedReason,
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

async function generateTextJson({ prompt, systemInstruction, fallback, maxOutputTokens = 256, temperature = 0.1 }) {
  const result = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
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
  const {
    screenshot,
    instruction,
    history,
    pageUrl,
    pageTitle,
    pageContext,
    sourceMode,
    tabs,
    activeTabId,
    overallGoal,
    planSummary,
    activeSubtask,
    workingMemory,
    failureContext,
  } = req.body ?? {};

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
- Prefer targetId from pageContext when a visible control clearly matches.
- Use visible labels, text, roles, and ordinal position for selectors.
- Include framePath or shadowPath only when they help disambiguate the target.
- Use open_tab when the task benefits from researching or comparing something in another tab.
- Use switch_tab when the target page is already open in another tab.
- Keep narration short and natural because it will be spoken aloud.`;

  const historyBlock = Array.isArray(history) && history.length > 0
    ? `\n\nSteps already completed:\n${history.map((step, index) => `${index + 1}. ${String(step)}`).join('\n')}\n\nDo not repeat completed steps. If any step is marked FAILED, try a different selector or approach.`
    : '';

  const taskExecutionBlocks = [
    typeof overallGoal === 'string' && overallGoal.trim() ? `Overall goal:\n${overallGoal.trim()}` : '',
    typeof planSummary === 'string' && planSummary.trim() ? `Current plan summary:\n${planSummary.trim()}` : '',
    typeof activeSubtask === 'string' && activeSubtask.trim() ? `Current subtask:\n${activeSubtask.trim()}` : '',
    Array.isArray(workingMemory) && workingMemory.length > 0
      ? `Remembered task facts:\n${workingMemory.slice(0, 10).map((item) => String(item).trim()).filter(Boolean).join('\n')}`
      : '',
    typeof failureContext === 'string' && failureContext.trim() ? `Recent failure context:\n${failureContext.trim()}` : '',
  ].filter(Boolean);

  const taskExecutionBlock = taskExecutionBlocks.length > 0
    ? `\n\nTask execution context:\n${taskExecutionBlocks.join('\n\n')}`
    : '';

  const prompt = `User instruction: "${instruction}"${getGroundingBlock(pageUrl, pageTitle)}${getSourceModeBlock(sourceMode)}${getTabsBlock(tabs, activeTabId)}${getPageContextBlock(pageContext)}${taskExecutionBlock}${historyBlock}

Respond with valid JSON only:
{
  "narration": "1-2 spoken sentences describing what matters for the user's goal",
  "action": {
    "type": "navigate|click|fill|type|select|press|hover|focus|check|uncheck|scroll|scroll_up|back|wait|open_tab|switch_tab|null",
    "targetId": "stable target id from pageContext when available",
    "selector": "visible text, aria-label, placeholder, or CSS selector",
    "index": 1,
    "tabId": "tab id to switch to when a matching tab already exists",
    "framePath": [1, 2],
    "shadowPath": [1],
    "value": "text to type, selected option, pressed key, or wait duration",
    "url": "URL to navigate to"
  }
}

If no action is needed, set action to null.
Prefer targetId when pageContext provides a clear visible control.
Use "index" only when there are multiple similar visible matches and ordinal targeting helps.
Use framePath or shadowPath only when they are needed to disambiguate the target.
Use open_tab when you need another page or source to complete the goal.
Use switch_tab when the needed page is already open.`;

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

app.post('/api/interpret-user-request', async (req, res) => {
  const {
    transcript,
    source,
    browserIsOpen,
    pageUrl,
    pageTitle,
    recentTurns,
    pendingClarificationQuestion,
  } = req.body ?? {};

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript string is required' });
  }

  const browserBlock = browserIsOpen
    ? `\n\nCurrent browser context:\n- Browser open: yes\n- URL: ${typeof pageUrl === 'string' && pageUrl ? pageUrl : '(unknown)'}\n- Title: ${typeof pageTitle === 'string' && pageTitle ? pageTitle : '(untitled)'}`
    : '\n\nCurrent browser context:\n- Browser open: no';

  const recentTurnsBlock = Array.isArray(recentTurns) && recentTurns.length > 0
    ? `\n\nRecent interaction context:\n${recentTurns.slice(-3).map((turn, index) => {
      if (!turn || typeof turn !== 'object') {
        return null;
      }

      const parts = [`${index + 1}. User: "${String(turn.user || '').trim()}"`];
      if (typeof turn.intent === 'string' && turn.intent) {
        parts.push(`intent=${turn.intent}`);
      }
      if (typeof turn.normalizedInstruction === 'string' && turn.normalizedInstruction.trim()) {
        parts.push(`normalized="${turn.normalizedInstruction.trim()}"`);
      }
      if (typeof turn.browserAssistiveIntent === 'string' && turn.browserAssistiveIntent) {
        parts.push(`assistive=${turn.browserAssistiveIntent}`);
      }
      if (typeof turn.assistant === 'string' && turn.assistant.trim()) {
        parts.push(`assistant="${turn.assistant.trim()}"`);
      }
      return parts.join(' | ');
    }).filter(Boolean).join('\n')}`
    : '';

  const clarificationBlock = typeof pendingClarificationQuestion === 'string' && pendingClarificationQuestion.trim()
    ? `\n\nPending clarification:\nSally previously asked: "${pendingClarificationQuestion.trim()}"\nInterpret the new user message as their answer when reasonable.`
    : '';

  const systemPrompt = `You are Sally's request interpreter. Your job is to infer what the human means in natural language, not to force them into exact command phrases.

Return valid JSON only with this exact shape:
{
  "intent": "browser_task|browser_assistive|describe_screen|summarize_screen|screen_question|smart_home|chat|cancel|clarify|none",
  "confidence": "high|medium|low",
  "normalizedInstruction": "string or null",
  "spokenResponse": "short spoken answer or null",
  "clarificationQuestion": "one short follow-up question or null",
  "browserAssistiveIntent": "actions|buttons|fields|errors|links|headings|null"
}

Use browser_task for website actions, browser_assistive for page walkthrough requests, describe_screen or summarize_screen for screen understanding, screen_question for a specific question about what is visible, smart_home for natural device commands, chat for a short spoken reply, cancel for explicit stop/cancel, clarify for ambiguous requests, and none for silence or nonsense.

Understand paraphrases and follow-ups from recent context. Screen-focused requests must still classify correctly even when no browser is open. Do not turn a screen request into chat just because the browser is closed. Browser availability affects execution readiness, not intent classification. Keep spokenResponse and clarificationQuestion short.`;

  const prompt = `User message (${source === 'typed' ? 'typed' : 'voice'}): "${transcript}"${browserBlock}${recentTurnsBlock}${clarificationBlock}

Respond with valid JSON only.

Guidance:
- If the user is asking Sally to go somewhere, search, click, type, compose, submit a form, or do a multi-step website action, use browser_task.
- If they are asking what is on screen or what page elements exist, use describe_screen, summarize_screen, screen_question, or browser_assistive as appropriate.
- Requests about the desktop or current screen still count as screen intents when no browser is open.
- Do not respond with a browser-unavailable chat answer for an obvious describe_screen, summarize_screen, or screen_question request.
- If they are just talking to Sally or asking what Sally can do, use chat with a short spokenResponse.
- If the request is too vague to act on safely, use clarify with one short clarificationQuestion.
- Use normalizedInstruction to preserve the task in short plain language.`;

  try {
    const raw = await generateTextJson({
      prompt,
      systemInstruction: systemPrompt,
      fallback: {
        intent: 'clarify',
        confidence: 'low',
        normalizedInstruction: null,
        spokenResponse: null,
        clarificationQuestion: 'What would you like me to do?',
        browserAssistiveIntent: null,
      },
      maxOutputTokens: 256,
      temperature: 0.1,
    });

    return res.json(normalizeUserRequestInterpretation(raw, transcript));
  } catch (error) {
    console.error('[Sally Backend] Gemini user-request error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Gemini API error: ${message}` });
  }
});

app.post('/api/plan-complex-task', async (req, res) => {
  const {
    goal,
    currentPlanSummary,
    activeSubtask,
    subtasks,
    history,
    workingMemory,
    failureCount,
    lastFailure,
    pageUrl,
    pageTitle,
    pageContext,
    sourceMode,
    tabs,
    activeTabId,
    triggerReason,
  } = req.body ?? {};

  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'goal string is required' });
  }

  const plannerStateBlocks = [
    typeof currentPlanSummary === 'string' && currentPlanSummary.trim()
      ? `Current plan summary:\n${currentPlanSummary.trim()}`
      : '',
    typeof activeSubtask === 'string' && activeSubtask.trim()
      ? `Current active subtask:\n${activeSubtask.trim()}`
      : '',
    Array.isArray(subtasks) && subtasks.length > 0
      ? `Current subtasks:\n${subtasks.slice(0, 6).map((subtask) => {
          if (!subtask || typeof subtask !== 'object') return null;
          const status = ['pending', 'active', 'done', 'blocked'].includes(subtask.status) ? subtask.status : 'pending';
          const id = typeof subtask.id === 'string' && subtask.id.trim() ? subtask.id.trim() : 'step';
          const title = typeof subtask.title === 'string' && subtask.title.trim() ? subtask.title.trim() : 'step';
          return `- [${status}] ${id}: ${title}`;
        }).filter(Boolean).join('\n')}`
      : '',
    Array.isArray(workingMemory) && workingMemory.length > 0
      ? `Remembered facts:\n${workingMemory.slice(0, 12).map((item) => String(item).trim()).filter(Boolean).join('\n')}`
      : '',
    Array.isArray(history) && history.length > 0
      ? `Recent action history:\n${history.slice(-12).map((item) => String(item)).join('\n')}`
      : '',
    Number.isFinite(failureCount) || (typeof lastFailure === 'string' && lastFailure.trim())
      ? `Consecutive failures: ${Number.isFinite(failureCount) ? failureCount : 0}${typeof lastFailure === 'string' && lastFailure.trim() ? `\nLast failure: ${lastFailure.trim()}` : ''}`
      : '',
    typeof triggerReason === 'string' && triggerReason.trim()
      ? `Planner refresh reason:\n${triggerReason.trim()}`
      : '',
  ].filter(Boolean);

  const plannerStateBlock = plannerStateBlocks.length > 0
    ? `\n\nPlanner state:\n${plannerStateBlocks.join('\n\n')}`
    : '';

  const systemPrompt = `You are Sally's browser task planner for longer website workflows.

Return valid JSON only with this exact shape:
{
  "status": "continue|complete|blocked|clarify",
  "planSummary": "short summary of the whole plan",
  "activeSubtask": "single short subtask Sally should work on next or null",
  "subtasks": [
    { "id": "s1", "title": "short subtask", "status": "pending|active|done|blocked" }
  ],
  "rememberedFacts": ["short fact", "another short fact"],
  "clarificationQuestion": "short question or null",
  "completionNarration": "short completion message or null",
  "blockedReason": "short blocker or null"
}

Rules:
- Break the goal into 2 to 5 short subtasks when useful.
- Keep the activeSubtask narrow enough for Sally's next-action loop.
- Use rememberedFacts for names, email addresses, dates, prices, selected links, and comparison facts.
- Use the current tabs and page context to avoid redundant work.
- Use status=complete when the task is already done.
- Use status=clarify only when the user must answer a short question.
- Use status=blocked when the site or missing data stops progress.
- Do not return long explanations.`;

  const prompt = `User goal: "${goal}"${getGroundingBlock(pageUrl, pageTitle)}${getSourceModeBlock(sourceMode)}${getTabsBlock(tabs, activeTabId)}${getPageContextBlock(pageContext)}${plannerStateBlock}

Respond with valid JSON only.

Guidance:
- Plan for a medium multi-step browser workflow.
- Use the current page and open tabs to avoid repeating work.
- Keep the activeSubtask narrow enough for Sally's next-action browser loop.
- Use rememberedFacts for reusable details the user may refer to later, like names, email addresses, dates, prices, or chosen links.
- If the goal is already done, return status="complete".
- If the task genuinely needs user input, return status="clarify" with one short clarificationQuestion.
- If the task is blocked by the site or missing data, return status="blocked" with blockedReason.`;

  try {
    const raw = await generateTextJson({
      prompt,
      systemInstruction: systemPrompt,
      fallback: {
        status: 'continue',
        planSummary: goal,
        activeSubtask: typeof activeSubtask === 'string' && activeSubtask.trim() ? activeSubtask.trim() : goal,
        subtasks: [
          {
            id: 's1',
            title: typeof activeSubtask === 'string' && activeSubtask.trim() ? activeSubtask.trim() : goal,
            status: 'active',
          },
        ],
        rememberedFacts: Array.isArray(workingMemory) ? workingMemory : [],
        clarificationQuestion: null,
        completionNarration: null,
        blockedReason: null,
      },
      maxOutputTokens: 512,
      temperature: 0.1,
    });

    return res.json(normalizeTaskPlan(raw, goal));
  } catch (error) {
    console.error('[Sally Backend] Gemini planner error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Gemini API error: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Sally Vision Backend running on port ${PORT}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
});
