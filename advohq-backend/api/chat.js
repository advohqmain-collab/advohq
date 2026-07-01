// Vercel Serverless Function — Advo AI chat proxy.
//
// Keeps the Anthropic API key server-side. The browser POSTs the conversation
// here; this function forwards it to Claude via the official Anthropic SDK.
// Set the key in Vercel:  Project → Settings → Environment Variables → ANTHROPIC_API_KEY
// (and in a local `.env` / `vercel env` for local dev).

const Anthropic = require('@anthropic-ai/sdk');

// ── Per-IP rate limiting (in-memory, best-effort) ──
// Counters live in this function instance's memory: zero setup, but they reset
// on cold starts and aren't shared across regions. Enough to stop one visitor
// from running up the bill. Override the numbers via env vars if you like.
const WINDOW_MS = 60 * 60 * 1000;                                  // 1 hour
const MAX_PER_WINDOW = parseInt(process.env.AI_MAX_PER_HOUR || '20', 10);
const BURST_MS = 60 * 1000;                                        // 1 minute
const MAX_PER_BURST = parseInt(process.env.AI_MAX_PER_MIN || '6', 10);

const hits = new Map(); // ip -> [timestamp, ...]

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  const inBurst = recent.filter((t) => now - t < BURST_MS);

  if (inBurst.length >= MAX_PER_BURST) {
    const retryAfter = Math.ceil((BURST_MS - (now - Math.min(...inBurst))) / 1000);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }
  if (recent.length >= MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - Math.min(...recent))) / 1000);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }

  recent.push(now);
  hits.set(ip, recent);
  // Light cleanup so the Map doesn't grow unbounded across many IPs.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  return { ok: true };
}

// Client is created lazily (and cached across warm invocations) so a missing
// key produces the clear 500 below instead of throwing at module load.
let anthropic = null;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = checkRateLimit(clientIp(req));
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: 'Usage limit reached. Please wait a little while before sending more messages.',
      retryAfter: limit.retryAfter,
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: 'Server is not configured: ANTHROPIC_API_KEY is missing.' });
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { messages = [], document = '' } = body;

  // Only forward well-formed user/assistant turns, capped for safety.
  const trimmed = (Array.isArray(messages) ? messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string',
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'No message provided.' });
  }

  const system =
    'You are Advo AI, a legal assistant inside AdvoHQ — a case and brief ' +
    'management app for advocates. Help users summarise documents, find key ' +
    'clauses, list action items, draft responses, and answer legal questions ' +
    'clearly and concisely. Keep answers practical and well structured. You are ' +
    'not a substitute for professional legal advice — remind users to verify ' +
    'important matters when it counts.' +
    (document ? ` The user currently has a document open titled "${document}".` : '');

  try {
    const message = await getClient().messages.create({
      // Override with the ANTHROPIC_MODEL env var. Opus is the strongest but
      // priciest; 'claude-sonnet-4-6' is a cheaper, faster default for chat.
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 1024,
      // Medium keeps chat replies snappy; bump to "high" if answers need to
      // reason more deeply (e.g. multi-clause contract analysis).
      output_config: { effort: 'medium' },
      system,
      messages: trimmed,
    });

    const reply = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Advo AI: invalid ANTHROPIC_API_KEY', err.message);
      return res.status(500).json({ error: 'Advo AI is misconfigured (invalid API key).' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error('Advo AI: upstream rate limited', err.message);
      return res.status(429).json({ error: 'Advo AI is busy right now. Please try again shortly.' });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error('Advo AI: connection to Anthropic failed', err.message);
      return res.status(502).json({ error: 'Advo AI could not reach the model. Please try again.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Advo AI: upstream API error', err.status, err.message);
      return res.status(502).json({ error: 'Advo AI upstream error.' });
    }
    console.error('Advo AI handler error', err);
    return res.status(500).json({ error: 'Advo AI request failed.' });
  }
};
