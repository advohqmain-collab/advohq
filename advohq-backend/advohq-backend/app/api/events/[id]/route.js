/**
 * GET    /api/events/:id
 * PATCH  /api/events/:id
 * DELETE /api/events/:id
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, noContent, err, corsHeaders } from '@/lib/api';

async function getOwnedEvent(eventId, userId) {
  const e = await queryOne(`SELECT * FROM events WHERE id = $1`, [eventId]);
  if (!e) { const err = new Error('Event not found'); err.status = 404; throw err; }
  if (e.owner_id !== userId) { const err = new Error('Forbidden'); err.status = 403; throw err; }
  return e;
}

export const GET = withAuth(async (request, { params }, user) => {
  const ev = await getOwnedEvent(params.id, user.sub);
  return ok(ev, request);
});

const UpdateSchema = z.object({
  caseId:    z.string().uuid().optional().nullable(),
  caseName:  z.string().optional().nullable(),
  eventType: z.enum(['hearing','meeting','deadline','filing','other']).optional(),
  title:     z.string().min(1).max(255).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventTime: z.string().optional().nullable(),
  court:     z.string().optional().nullable(),
  judge:     z.string().optional().nullable(),
  notes:     z.string().optional().nullable(),
}).strict();

export const PATCH = withAuth(async (request, { params }, user) => {
  await getOwnedEvent(params.id, user.sub);

  const body   = await request.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;
  const colMap = {
    caseId:    'case_id',
    caseName:  'case_name',
    eventType: 'event_type',
    title:     'title',
    eventDate: 'event_date',
    eventTime: 'event_time',
    court:     'court',
    judge:     'judge',
    notes:     'notes',
  };

  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(colMap)) {
    if (k in d) { sets.push(`${col} = $${i++}`); vals.push(d[k]); }
  }
  if (!sets.length) return err('No fields to update', request);

  vals.push(params.id);
  const updated = await queryOne(
    `UPDATE events SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return ok(updated, request);
});

export const DELETE = withAuth(async (request, { params }, user) => {
  await getOwnedEvent(params.id, user.sub);
  await query(`DELETE FROM events WHERE id = $1`, [params.id]);
  return noContent(request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
