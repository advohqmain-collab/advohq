/**
 * POST /api/chat
 * ──────────────
 * Advo AI chat proxy. Keeps the Anthropic API key server-side. The browser
 * POSTs the conversation here; this forwards it to Claude via the official
 * Anthropic SDK.
 *
 * Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in the environment.
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { corsHeaders, handleOptions } from '@/lib/api';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';

// ── Rate limiting (per-IP, burst + hourly) ──
const burstLimit = createRateLimiter({ windowMs: 60 * 1000, max: parseInt(process.env.AI_MAX_PER_MIN || '6', 10) });
const hourLimit  = createRateLimiter({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.AI_MAX_PER_HOUR || '20', 10) });

// Client is created lazily (and cached across warm invocations) so a missing
// key produces the clear 500 below instead of throwing at module load.
let anthropic = null;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

function jsonErr(message, request, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: corsHeaders(request) });
}

export async function POST(request) {
  const ip = clientIp(request);
  const burst = burstLimit(ip);
  const hour  = burst.ok ? hourLimit(ip) : burst;
  if (!burst.ok || !hour.ok) {
    const limit = !burst.ok ? burst : hour;
    return jsonErr(
      'Usage limit reached. Please wait a little while before sending more messages.',
      request, 429, { retryAfter: limit.retryAfter }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonErr('Server is not configured: ANTHROPIC_API_KEY is missing.', request, 500);
  }

  const body = await request.json().catch(() => ({}));
  const { messages = [], document = '' } = body;

  // Only forward well-formed user/assistant turns, capped for safety.
  const trimmed = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (trimmed.length === 0) {
    return jsonErr('No message provided.', request, 400);
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

    return NextResponse.json({ reply }, { status: 200, headers: corsHeaders(request) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Advo AI: invalid ANTHROPIC_API_KEY', err.message);
      return jsonErr('Advo AI is misconfigured (invalid API key).', request, 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error('Advo AI: upstream rate limited', err.message);
      return jsonErr('Advo AI is busy right now. Please try again shortly.', request, 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error('Advo AI: connection to Anthropic failed', err.message);
      return jsonErr('Advo AI could not reach the model. Please try again.', request, 502);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Advo AI: upstream API error', err.status, err.message);
      return jsonErr('Advo AI upstream error.', request, 502);
    }
    console.error('Advo AI handler error', err);
    return jsonErr('Advo AI request failed.', request, 500);
  }
}

export const OPTIONS = (req) => handleOptions(req);
