// Sally Vision Backend — Gemini screen interpretation proxy
// Deployed on Google Cloud Run
// POST /api/interpret-screen  { screenshot: base64PNG, instruction: string }
//   → { narration: string, action: { type, selector, value, url } | null }

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

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

app.post('/api/interpret-screen', async (req, res) => {
  const { screenshot, instruction } = req.body;

  if (!screenshot || typeof screenshot !== 'string') {
    return res.status(400).json({ error: 'screenshot (base64 PNG) is required' });
  }
  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'instruction string is required' });
  }

  const systemPrompt = `You are Sally, a vision assistant for blind and low-vision users. You receive screenshots and user voice commands.

Your job:
1. Describe the screen in 1-2 natural spoken sentences, focusing on what's most relevant to the user's instruction.
2. If the user wants to interact with something, identify the target element.

Rules:
- Never mention coordinates or pixel positions
- Prefer ARIA labels, button text, link text, and semantic roles over CSS selectors
- Keep narration short and speakable — it will be read aloud via text-to-speech
- For actions, use the most accessible selector available (text content, aria-label, role)
- If the instruction is purely descriptive ("what do I see", "describe"), set action to null`;

  const userPrompt = `User instruction: "${instruction}"

Analyze the screenshot and respond with valid JSON only (no markdown, no code block):
{
  "narration": "1-2 spoken sentences describing what's relevant",
  "action": {
    "type": "click|fill|navigate|select|null",
    "selector": "CSS selector or aria-label or button text",
    "value": "text to type (for fill actions)",
    "url": "URL (for navigate actions)"
  }
}

If no action is needed, set action to null.`;

  try {
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
            { text: userPrompt },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        temperature: 0.2,
      },
    });

    const text = result.text || '';
    console.log('[Sally Backend] Gemini raw response:', text.substring(0, 200));

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Gemini sometimes wraps JSON in markdown even when asked not to
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = { narration: text, action: null };
      }
    }

    return res.json({
      narration: parsed.narration || 'I can see the screen.',
      action: parsed.action || null,
    });
  } catch (error) {
    console.error('[Sally Backend] Gemini error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Gemini API error: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Sally Vision Backend running on port ${PORT}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
});
