// Audio transcription service — Gemini 2.5 Flash (primary) or OpenAI Whisper (fallback)
import { apiKeyManager } from '../managers/apiKeyManager.js';
import { GEMINI_MODEL } from '../utils/constants.js';

class WhisperService {
  async transcribe(audioBase64: string, mimeType: string): Promise<string> {
    const geminiKey = apiKeyManager.getGeminiApiKey();
    const whisperKey = apiKeyManager.getWhisperKey();

    if (geminiKey) {
      try {
        return await this.transcribeWithGemini(audioBase64, mimeType, geminiKey);
      } catch (error) {
        console.warn('[Transcription] Gemini failed, falling back to Whisper:', error);
        if (whisperKey) {
          return this.transcribeWithWhisper(audioBase64, mimeType, whisperKey);
        }
        throw error;
      }
    }

    if (whisperKey) {
      try {
        return await this.transcribeWithWhisper(audioBase64, mimeType, whisperKey);
      } catch (error) {
        console.warn('[Transcription] Whisper failed, falling back to Gemini:', error);
        if (geminiKey) {
          return this.transcribeWithGemini(audioBase64, mimeType, geminiKey);
        }
        throw error;
      }
    }

    if (geminiKey) {
      return this.transcribeWithGemini(audioBase64, mimeType, geminiKey);
    }

    throw new Error('No transcription API key configured. Set a Gemini or OpenAI key in settings.');
  }

  private async transcribeWithGemini(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
    // Gemini 2.5 Flash supports inline audio for transcription.
    const geminiMime = mimeType.includes('webm') ? 'audio/webm'
      : mimeType.includes('mp4') ? 'audio/mp4'
      : mimeType.includes('wav') ? 'audio/wav'
      : mimeType;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: geminiMime,
                  data: audioBase64,
                },
              },
              {
                text: 'Transcribe this audio recording into text. Write out exactly what the person is saying. Output only the spoken words, no commentary or labels.',
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini transcription error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    console.log('[Transcription] Gemini result:', text);
    return text;
  }

  private async transcribeWithWhisper(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';

    // Build multipart form data manually for Node.js
    const boundary = '----SallyFormBoundary' + Date.now();
    const parts: Buffer[] = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-1\r\n`
    ));

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { text: string };
    console.log('[Transcription] Whisper result:', result.text);
    return result.text;
  }
}

export const whisperService = new WhisperService();
