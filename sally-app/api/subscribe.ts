import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body ?? {};

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error('Missing RESEND_API_KEY or RESEND_AUDIENCE_ID env vars');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  try {
    const response = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      },
    );

    if (response.ok || response.status === 409) {
      return res.status(200).json({ success: true, message: "You're on the list!" });
    }

    const body = await response.text();
    console.error(`Resend API error: ${response.status} ${body}`);
    return res.status(502).json({ error: 'Could not subscribe. Please try again later.' });
  } catch (err) {
    console.error('Resend API request failed:', err);
    return res.status(502).json({ error: 'Could not subscribe. Please try again later.' });
  }
}
