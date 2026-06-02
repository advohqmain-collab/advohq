/**
 * GET  /api/events   — list events (supports ?from=&to= date range)
 * POST /api/events   — create event
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, created, err, parsePagination, corsHeaders } from '@/lib/api';

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (request, _ctx, user) => {
  const url    = new URL(request.url);
  const from   = url.searchParams.get('from');
  const to     = url.searchParams.get('to');
  const type   = url.searchParams.get('type');
  const caseId = url.searchParams.get('caseId');
  const { limit, offset } = parsePagination(request.url);

  const conditions = ['owner_id = $1'];
  const params     = [user.sub];
  let i = 2;

  if (from)   { conditions.push(`event_date >= $${i++}`); params.push(from); }
  if (to)     { conditions.push(`event_date <= $${i++}`); params.push(to);   }
  if (type)   { conditions.push(`event_type = $${i++}`);  params.push(type); }
  if (caseId) { conditions.push(`case_id = $${i++}`);     params.push(caseId); }

  const where = conditions.join(' AND ');

  const rows = await query(
    `SELECT * FROM events
     WHERE ${where}
     ORDER BY event_date ASC, event_time ASC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  const countRow = await queryOne(
    `SELECT count(*)::int AS total FROM events WHERE ${where}`,
    params
  );

  return ok({ events: rows, total: countRow?.total ?? 0 }, request);
});

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  caseId:    z.string().uuid().optional().nullable(),
  caseName:  z.string().optional(),
  eventType: z.enum(['hearing','meeting','deadline','filing','other']).default('hearing'),
  title:     z.string().min(1).max(255),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  eventTime: z.string().optional().nullable(),
  court:     z.string().optional().nullable(),
  judge:     z.string().optional().nullable(),
  notes:     z.string().optional().nullable(),
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body   = await request.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;

  const row = await queryOne(
    `INSERT INTO events
       (case_id, case_name, event_type, title,
        event_date, event_time, court, judge, notes, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      d.caseId ?? null, d.caseName ?? null, d.eventType, d.title,
      d.eventDate, d.eventTime ?? null,
      d.court ?? null, d.judge ?? null, d.notes ?? null,
      user.sub,
    ]
  );

  return created(row, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
