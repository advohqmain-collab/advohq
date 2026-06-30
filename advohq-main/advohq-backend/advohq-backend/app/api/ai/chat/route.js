/**
 * POST /api/ai/chat
 * ─────────────────
 * AdvoAI — proxies questions to OpenAI chat completions.
 * Keeps the API key server-side only.
 *
 * Body: { question, documentContext? }
 * Returns: { answer }
 *
 * Required env var: OPENAI_API_KEY
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, ok, err, corsHeaders } from '@/lib/api';

const Schema = z.object({
  question:        z.string().min(1).max(2000),
  documentContext: z.string().max(20000).optional().nullable(),
});

const SYSTEM_PROMPT = `You are AdvoAI, an expert legal assistant for advocates and lawyers.
You help with document analysis, case research, drafting responses, identifying key clauses,
and summarising legal documents. Be concise, accurate, and professional.
When a document context is provided, base your answer on it.
If no document context is provided, answer from general legal knowledge.`;

export const POST = withAuth(async (request, _ctx, _user) => {
  if (!process.env.OPENAI_API_KEY) {
    return err('OPENAI_API_KEY is not configured on the server', request, 503);
  }

  const body   = await request.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const { question, documentContext } = parsed.data;

  const userContent = documentContext
    ? `Document context:\n"""\n${documentContext}\n"""\n\nQuestion: ${question}`
    : question;

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!openaiRes.ok) {
    const detail = await openaiRes.json().catch(() => ({}));
    console.error('[ai/chat] OpenAI error', detail);
    return err(detail?.error?.message || 'OpenAI request failed', request, 502);
  }

  const data   = await openaiRes.json();
  const answer = data.choices?.[0]?.message?.content?.trim() ?? '';

  return ok({ answer }, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
